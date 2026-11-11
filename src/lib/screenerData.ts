// Server side of the screener: every listed company's latest yearly SEC inputs, one row per
// company (its most valuable share class). Built from our database (no provider calls) and
// kept in memory for a few hours per server instance: ~5,000 rows are too big for the data
// cache, and they only change when the weekly SEC job runs.
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { companyMetrics, securities } from "@/db/schema";
import { latestMetricsYear } from "./peers";
import { cleanInputs } from "./secFrames";
import { screenRow, type ScreenRow } from "./screener";
import type { Result } from "./types";

export interface Universe {
  year: number; // calendar year of the figures (SEC frames)
  updatedAt: string;
  rows: ScreenRow[];
}

const TTL_MS = 6 * 3600 * 1000;
let memo: { at: number; p: Promise<Universe | null> } | null = null;

export async function loadUniverse(db: Db): Promise<Universe | null> {
  const latest = await latestMetricsYear(db);
  if (!latest) return null;
  const raw = await db
    .select({
      symbol: securities.symbol,
      name: securities.name,
      cik: securities.cik,
      rank: securities.rank,
      sic: securities.sic,
      industry: securities.sicDescription,
      inputs: companyMetrics.inputs,
    })
    .from(securities)
    .innerJoin(companyMetrics, and(eq(companyMetrics.cik, securities.cik), eq(companyMetrics.year, latest.year)))
    .where(eq(securities.active, true))
    .orderBy(sql`${securities.rank} asc nulls last`, asc(securities.symbol));
  const seen = new Set<number>();
  const rows: ScreenRow[] = [];
  for (const r of raw) {
    if (seen.has(r.cik)) continue; // first row per company = its largest share class
    seen.add(r.cik);
    rows.push(screenRow({ symbol: r.symbol, name: r.name, cik: r.cik, rank: r.rank, sic: r.sic, industry: r.industry }, cleanInputs(r.inputs)));
  }
  return { year: latest.year, updatedAt: latest.updatedAt.toISOString(), rows };
}

/** The screener's universe, or why it's unavailable (no database, no SEC data loaded yet). */
export async function getUniverse(now = Date.now()): Promise<Result<Universe>> {
  const db = getDb();
  if (!db) return { ok: false, error: "not_configured" };
  if (!memo || now - memo.at > TTL_MS) {
    const p = loadUniverse(db);
    memo = { at: now, p };
    p.catch(() => {
      if (memo?.p === p) memo = null; // failures aren't kept
    });
  }
  try {
    const u = await memo.p;
    return u ? { ok: true, data: u, fetchedAt: u.updatedAt } : { ok: false, error: "not_found" };
  } catch (e) {
    console.error(JSON.stringify({ event: "screener_error", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, error: "upstream" };
  }
}
