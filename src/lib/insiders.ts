// Insider transactions (SEC Form 4) for an issuer: read incrementally into Postgres, then
// summarized. Only filings not read before are downloaded, under a time budget, so the first
// visit to a busy company may take a couple of requests to complete (the UI says so).
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { insiderChecks, insiderFilings, insiderTransactions } from "@/db/schema";
import { form4XmlUrl, parseForm4, summarize, type InsiderSummary, type InsiderTx } from "./form4";
import { secJson, secText, submissionsUrl } from "./sec";
import { getSecurity } from "./securities";
import type { DataIssue, Result } from "./types";

export const WINDOW_DAYS = 365;
const LOOKBACK_DAYS = WINDOW_DAYS + 45; // filings arrive up to 2 business days after the trade, plus late filers
const STALE_MS = 6 * 60 * 60 * 1000;
const REQUEST_BUDGET_MS = 15_000;
const CHUNK = 200;

export type FetchJson = (url: string) => Promise<unknown>;
export type FetchText = (url: string) => Promise<string>;

interface Listed {
  accn: string;
  filed: string;
  doc: string;
}

type Recent = { form?: string[]; filingDate?: string[]; accessionNumber?: string[]; primaryDocument?: string[] };

function form4s(recent: Recent, since: string): Listed[] {
  const out: Listed[] = [];
  const n = recent.form?.length ?? 0;
  for (let i = 0; i < n; i++) {
    const filed = recent.filingDate?.[i] ?? "";
    // 4/A amendments restate an earlier Form 4: skipped so nothing is counted twice.
    if (recent.form?.[i] !== "4" || filed < since) continue;
    const accn = recent.accessionNumber?.[i];
    const doc = recent.primaryDocument?.[i];
    if (accn && doc) out.push({ accn, filed, doc });
  }
  return out;
}

/** Form 4 filings for the issuer since `since`, newest first (older pages read only if needed). */
export async function listForm4(cik: number, since: string, fetchJson: FetchJson): Promise<Listed[]> {
  const sub = (await fetchJson(submissionsUrl(cik))) as { filings?: { recent?: Recent; files?: { name: string }[] } };
  const recent = sub.filings?.recent ?? {};
  const list = form4s(recent, since);
  const oldest = recent.filingDate?.reduce((m, d) => (d < m ? d : m), "9999") ?? "";
  const extra = sub.filings?.files?.[0]?.name;
  if (oldest > since && extra) {
    // A very active filer: the "recent" page doesn't reach back far enough.
    list.push(...form4s((await fetchJson(`https://data.sec.gov/submissions/${extra}`)) as Recent, since));
  }
  return list.sort((a, b) => (a.filed < b.filed ? 1 : -1));
}

export interface RefreshResult {
  read: number;
  failed: number;
  pending: number;
}

/** Downloads Form 4 filings not stored yet, newest first, until the time budget runs out. */
export async function refreshInsiders(
  db: Db,
  cik: number,
  opts: { budgetMs?: number; today?: string; fetchJson?: FetchJson; fetchText?: FetchText } = {},
): Promise<RefreshResult> {
  const { budgetMs = REQUEST_BUDGET_MS, fetchJson = secJson, fetchText = secText } = opts;
  const deadline = Date.now() + budgetMs;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const since = new Date(Date.parse(today) - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);

  const listed = await listForm4(cik, since, fetchJson);
  const known = new Set<string>();
  for (let i = 0; i < listed.length; i += CHUNK) {
    const ids = listed.slice(i, i + CHUNK).map((l) => l.accn);
    const rows = await db.select({ accn: insiderFilings.accn }).from(insiderFilings).where(inArray(insiderFilings.accn, ids));
    rows.forEach((r) => known.add(r.accn));
  }
  const todo = listed.filter((l) => !known.has(l.accn));

  let read = 0;
  let failed = 0;
  for (const f of todo) {
    if (Date.now() >= deadline) break;
    let txs: InsiderTx[] | null = null;
    try {
      txs = parseForm4(await fetchText(form4XmlUrl(cik, f.accn, f.doc)), f.accn);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 429 || (status !== undefined && status >= 500) || (e instanceof Error && e.name === "TimeoutError")) break; // try later
      txs = null; // missing or malformed document: record it so it isn't fetched again
    }
    if (txs && txs.length) {
      await db
        .insert(insiderTransactions)
        .values(txs.map((t) => ({ ...t, issuerCik: cik })))
        .onConflictDoNothing();
    }
    await db
      .insert(insiderFilings)
      .values({ accn: f.accn, issuerCik: cik, filed: f.filed, status: txs ? "ok" : "error" })
      .onConflictDoNothing();
    if (txs) read++;
    else failed++;
  }
  const pending = todo.length - read - failed;
  await db
    .insert(insiderChecks)
    .values({ issuerCik: cik, checkedAt: new Date(), pending })
    .onConflictDoUpdate({ target: insiderChecks.issuerCik, set: { checkedAt: new Date(), pending } });
  return { read, failed, pending };
}

export interface InsiderRow extends InsiderTx {
  url: string; // the filing on EDGAR
}

export interface InsidersPayload {
  symbol: string;
  cik: number;
  summary: InsiderSummary;
  recent: InsiderRow[]; // latest purchases and sales
  pending: number; // filings still to read (shown as "partial")
  checkedAt: string;
}

export function filingIndexUrl(cik: number, accn: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accn.replace(/-/g, "")}/${accn}-index.htm`;
}

export async function buildInsiders(
  db: Db,
  symbol: string,
  cik: number,
  opts: Parameters<typeof refreshInsiders>[2] = {},
): Promise<Result<InsidersPayload>> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const [check] = await db.select().from(insiderChecks).where(eq(insiderChecks.issuerCik, cik)).limit(1);
  let refreshError: DataIssue | null = null;
  if (!check || check.pending > 0 || Date.now() - check.checkedAt.getTime() > STALE_MS) {
    try {
      await refreshInsiders(db, cik, { ...opts, today });
    } catch (e) {
      const status = (e as { status?: number }).status;
      refreshError = status === 429 ? "rate_limited" : status === 404 ? "not_found" : "upstream";
      console.error(JSON.stringify({ event: "insiders_refresh_error", symbol, status: status ?? null, message: e instanceof Error ? e.message : String(e) }));
    }
  }
  const [state] = await db.select().from(insiderChecks).where(eq(insiderChecks.issuerCik, cik)).limit(1);
  if (!state) return { ok: false, error: refreshError ?? "upstream" }; // never read anything

  const since = new Date(Date.parse(today) - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const rows = await db
    .select()
    .from(insiderTransactions)
    .where(and(eq(insiderTransactions.issuerCik, cik), gte(insiderTransactions.date, since)))
    .orderBy(desc(insiderTransactions.date), desc(insiderTransactions.accn), insiderTransactions.seq);
  const txs: InsiderTx[] = rows.map(({ issuerCik: _issuer, ...t }) => t);
  const recent = txs
    .filter((t) => (t.code === "P" && t.acquired) || (t.code === "S" && !t.acquired))
    .slice(0, 30)
    .map((t) => ({ ...t, url: filingIndexUrl(cik, t.accn) }));
  return {
    ok: true,
    fetchedAt: state.checkedAt.toISOString(),
    data: { symbol, cik, summary: summarize(txs, today, WINDOW_DAYS), recent, pending: state.pending, checkedAt: state.checkedAt.toISOString() },
  };
}

export async function getInsiders(symbol: string): Promise<Result<InsidersPayload>> {
  const db = getDb();
  if (!db) return { ok: false, error: "not_configured" };
  try {
    const security = await getSecurity(db, symbol);
    if (!security) return { ok: false, error: "not_found" };
    return await buildInsiders(db, security.symbol, security.cik);
  } catch (e) {
    console.error(JSON.stringify({ event: "insiders_error", symbol, message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, error: "upstream" };
  }
}
