// Peer data for sector percentiles: SIC codes per company (SEC submissions, filled in
// gradually, largest companies first) and yearly inputs for every filer (SEC frames).
import { and, asc, eq, gte, isNull, lte, max, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { companyMetrics, securities } from "@/db/schema";
import type { RatioInputs } from "./ratios";
import { parseSubmissions, secJson, submissionsUrl } from "./sec";
import { cleanInputs, collectYear, frameUrl, parseFrame, pickReferenceYear, type FetchJson } from "./secFrames";

const CHUNK = 500;
const log = (event: string, extra: Record<string, unknown> = {}) => console.info(JSON.stringify({ event, ...extra }));

// ---- SIC codes ----------------------------------------------------------------

async function storeSic(db: Db, cik: number, fetchJson: FetchJson): Promise<{ sic: number | null; sicDescription: string | null }> {
  let info: { sic: number | null; sicDescription: string | null };
  try {
    info = parseSubmissions(await fetchJson(submissionsUrl(cik)));
  } catch (e) {
    if ((e as { status?: number }).status !== 404) throw e;
    info = { sic: null, sicDescription: null }; // no submissions file: record the check, don't retry daily
  }
  await db.update(securities).set({ ...info, sicCheckedAt: new Date() }).where(eq(securities.cik, cik));
  return info;
}

/** The company's SIC, fetched once from the SEC if it hasn't been checked yet. */
export async function ensureSic(db: Db, cik: number, fetchJson: FetchJson = secJson) {
  const [row] = await db
    .select({ sic: securities.sic, sicDescription: securities.sicDescription, checked: securities.sicCheckedAt })
    .from(securities)
    .where(eq(securities.cik, cik))
    .limit(1);
  if (row?.checked) return { sic: row.sic, sicDescription: row.sicDescription };
  return storeSic(db, cik, fetchJson);
}

/** Fills missing SIC codes, largest companies first, until the time budget runs out. */
export async function backfillSic(db: Db, budgetMs: number, fetchJson: FetchJson = secJson): Promise<{ filled: number; remaining: number }> {
  const deadline = Date.now() + budgetMs;
  const pending = await db
    .select({ cik: securities.cik, rank: sql<number>`min(${securities.rank})` })
    .from(securities)
    .where(and(eq(securities.active, true), isNull(securities.sicCheckedAt)))
    .groupBy(securities.cik)
    .orderBy(sql`min(${securities.rank}) asc nulls last`);
  let filled = 0;
  for (const { cik } of pending) {
    if (Date.now() >= deadline) break;
    try {
      await storeSic(db, cik, fetchJson);
      filled++;
    } catch (e) {
      log("sic_backfill_stopped", { cik, message: e instanceof Error ? e.message : String(e) });
      break; // likely rate limited: stop and resume next run
    }
  }
  return { filled, remaining: pending.length - filled };
}

// ---- Yearly inputs from frames ------------------------------------------------------

export async function latestMetricsYear(db: Db): Promise<{ year: number; updatedAt: Date } | null> {
  const [row] = await db
    .select({ year: max(companyMetrics.year) })
    .from(companyMetrics);
  if (!row?.year) return null;
  const [u] = await db
    .select({ updatedAt: max(companyMetrics.updatedAt) })
    .from(companyMetrics)
    .where(eq(companyMetrics.year, row.year));
  return { year: row.year, updatedAt: u?.updatedAt ?? new Date(0) };
}

/** Picks the reference year from frame coverage and stores every listed company's inputs. */
export async function refreshCompanyMetrics(db: Db, now = new Date(), fetchJson: FetchJson = secJson) {
  const y = now.getUTCFullYear();
  const counts = [];
  for (const year of [y - 1, y - 2]) {
    const pts = parseFrame(await fetchJson(frameUrl("NetIncomeLoss", "USD", `CY${year}`))).length;
    counts.push({ year, pts });
  }
  const year = pickReferenceYear(counts);
  if (!year) throw new Error("metrics: no reference year");

  const listed = await db.selectDistinct({ cik: securities.cik }).from(securities).where(eq(securities.active, true));
  const byCik = await collectYear(year, fetchJson, new Set(listed.map((r) => r.cik)));
  if (byCik.size === 0) throw new Error("metrics: frames returned no listed companies");

  const updatedAt = new Date();
  const rows = [...byCik.entries()].map(([cik, inputs]) => ({ cik, year, inputs: inputs as Record<string, number>, updatedAt }));
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db
      .insert(companyMetrics)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: [companyMetrics.cik, companyMetrics.year],
        set: { inputs: sql`excluded.inputs`, updatedAt: sql`excluded.updated_at` },
      });
  }
  return { year, companies: rows.length };
}

// ---- Peers -------------------------------------------------------------------------------

export interface PeerRow {
  cik: number;
  sic: number;
  inputs: RatioInputs;
}

/** Peers in the same 2-digit SIC major group for a year, excluding the company itself. */
export async function peerInputs(db: Db, sic: number, year: number, excludeCik: number): Promise<PeerRow[]> {
  const lo = Math.floor(sic / 100) * 100;
  const peers = db
    .selectDistinct({ cik: securities.cik, sic: securities.sic })
    .from(securities)
    .where(and(eq(securities.active, true), gte(securities.sic, lo), lte(securities.sic, lo + 99), ne(securities.cik, excludeCik)))
    .as("peers");
  const rows = await db
    .select({ cik: companyMetrics.cik, sic: peers.sic, inputs: companyMetrics.inputs })
    .from(companyMetrics)
    .innerJoin(peers, eq(peers.cik, companyMetrics.cik))
    .where(eq(companyMetrics.year, year))
    .orderBy(asc(companyMetrics.cik));
  // A CIK with share classes in two SIC rows can't happen (SIC is per CIK), but dedupe anyway.
  const seen = new Set<number>();
  return rows.flatMap((r) => (seen.has(r.cik) || r.sic === null ? [] : (seen.add(r.cik), [{ cik: r.cik, sic: r.sic, inputs: cleanInputs(r.inputs) }])));
}

// ---- Peers for valuation ---------------------------------------------------------------

export interface ListedPeer extends PeerRow {
  symbol: string;
  rank: number | null;
}

/**
 * The largest listed companies in the same 2-digit SIC group with yearly inputs, one
 * symbol per company (its most valuable share class), largest first.
 */
export async function listedPeers(db: Db, sic: number, year: number, excludeCik: number, limit = 40): Promise<ListedPeer[]> {
  const lo = Math.floor(sic / 100) * 100;
  const rows = await db
    .select({
      cik: securities.cik,
      symbol: securities.symbol,
      rank: securities.rank,
      sic: securities.sic,
      inputs: companyMetrics.inputs,
    })
    .from(securities)
    .innerJoin(companyMetrics, and(eq(companyMetrics.cik, securities.cik), eq(companyMetrics.year, year)))
    .where(and(eq(securities.active, true), gte(securities.sic, lo), lte(securities.sic, lo + 99), ne(securities.cik, excludeCik)))
    .orderBy(sql`${securities.rank} asc nulls last`, asc(securities.symbol));
  const seen = new Set<number>();
  const out: ListedPeer[] = [];
  for (const r of rows) {
    if (seen.has(r.cik) || r.sic === null) continue;
    seen.add(r.cik);
    out.push({ cik: r.cik, symbol: r.symbol, rank: r.rank, sic: r.sic, inputs: cleanInputs(r.inputs) });
    if (out.length >= limit) break;
  }
  return out;
}

/** A company's own yearly inputs (same source and year as its peers). */
export async function companyYearInputs(db: Db, cik: number, year: number): Promise<RatioInputs | null> {
  const [row] = await db
    .select({ inputs: companyMetrics.inputs })
    .from(companyMetrics)
    .where(and(eq(companyMetrics.cik, cik), eq(companyMetrics.year, year)))
    .limit(1);
  return row ? cleanInputs(row.inputs) : null;
}

/** Largest listed peers, same 3-digit SIC first, then the rest of the 2-digit group. */
export async function suggestedPeers(db: Db, sic: number, year: number, cik: number, n: number): Promise<string[]> {
  const pool = await listedPeers(db, sic, year, cik, 40);
  const close = pool.filter((p) => Math.floor(p.sic / 10) === Math.floor(sic / 10));
  const rest = pool.filter((p) => Math.floor(p.sic / 10) !== Math.floor(sic / 10));
  return [...close, ...rest].slice(0, n).map((p) => p.symbol);
}
