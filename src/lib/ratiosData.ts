// Server-side: ratios with context (own 10-year history and sector percentiles) for a ticker.
import { unstable_cache } from "next/cache";
import { getDb, type Db } from "@/db/client";
import { getFinancials, type FinancialsPayload } from "./financials";
import { ensureSic, latestMetricsYear, peerInputs, type PeerRow } from "./peers";
import {
  RATIOS, REVENUE_BASED, applies, businessType, computeRatios, inputsFromStatements, median, percentileRank, ratioNote,
  type BusinessType, type RatioGroup, type RatioKey, type RatioNote,
} from "./ratios";
import type { DataIssue, Result } from "./types";

export const HISTORY_YEARS = 10;
export const MIN_OWN_YEARS = 5;
const MIN_PEERS_INDUSTRY = 15; // 3-digit SIC
const MIN_PEERS_MAJOR = 10; // 2-digit SIC

export interface Comparison {
  percentile: number; // 0–100, where the latest value sits
  median: number;
  n: number;
}

export interface RatioRow {
  key: RatioKey;
  group: RatioGroup;
  better: "higher" | "lower";
  applicable: boolean;
  value: number | null; // latest fiscal year
  note: RatioNote | null;
  history: { label: string; value: number | null }[];
  own: Comparison | null; // vs its own last 10 years
  sector: (Comparison & { sicPrefix: string }) | null;
}

export interface RatiosPayload {
  symbol: string;
  cik: number;
  businessType: BusinessType;
  sic: number | null;
  sicDescription: string | null;
  period: { label: string; end: string } | null;
  peersYear: number | null;
  ratios: RatioRow[];
}

function compare(values: number[], x: number): Comparison | null {
  const p = percentileRank(values, x);
  const m = median(values);
  return p === null || m === null ? null : { percentile: p, median: m, n: values.length };
}

/** Narrowest SIC group with enough peers that report the ratio. */
export function sectorComparison(key: RatioKey, x: number, sic: number, peers: PeerRow[]): RatioRow["sector"] {
  // Peers whose revenue is ambiguous in SEC data stay out of revenue-based comparisons.
  const usable = REVENUE_BASED.has(key) ? peers.filter((p) => !p.inputs.revenueAmbiguous) : peers;
  const values = (rows: PeerRow[]) =>
    rows.map((p) => computeRatios(p.inputs)[key]).filter((v): v is number => v !== null);
  const industry = values(usable.filter((p) => Math.floor(p.sic / 10) === Math.floor(sic / 10)));
  if (industry.length >= MIN_PEERS_INDUSTRY) {
    const c = compare(industry, x);
    return c && { ...c, sicPrefix: String(Math.floor(sic / 10)) };
  }
  const major = values(usable);
  if (major.length >= MIN_PEERS_MAJOR) {
    const c = compare(major, x);
    return c && { ...c, sicPrefix: String(Math.floor(sic / 100)) };
  }
  return null;
}

export async function buildRatios(db: Db, symbol: string): Promise<Result<RatiosPayload>> {
  const fin = await getFinancials(symbol);
  if (!fin.ok) return fin;
  return { ok: true, data: await assembleRatios(db, fin.data), fetchedAt: fin.fetchedAt };
}

/** Ratios for a company whose statements are already loaded. */
export async function assembleRatios(db: Db, fin: Pick<FinancialsPayload, "symbol" | "cik" | "annual">): Promise<RatiosPayload> {
  const { cik, annual, symbol } = fin;

  let sicInfo: { sic: number | null; sicDescription: string | null } = { sic: null, sicDescription: null };
  try {
    sicInfo = await ensureSic(db, cik);
  } catch (e) {
    console.error(JSON.stringify({ event: "ratios_sic_error", symbol, message: e instanceof Error ? e.message : String(e) }));
  }
  const type = businessType(sicInfo.sic);

  let peers: PeerRow[] = [];
  let peersYear: number | null = null;
  if (sicInfo.sic) {
    const latest = await latestMetricsYear(db);
    if (latest) {
      peersYear = latest.year;
      peers = await peerInputs(db, sicInfo.sic, latest.year, cik);
    }
  }

  const inputs = inputsFromStatements(annual).slice(-HISTORY_YEARS);
  const periods = annual.periods.slice(-HISTORY_YEARS);
  const series = inputs.map(computeRatios);
  const last = inputs.length - 1;

  const ratios: RatioRow[] = RATIOS.map((r) => {
    const applicable = applies(r.key, type);
    // A ratio that doesn't fit the business (e.g. gross margin for a bank) carries no numbers.
    const history = periods.map((p, i) => ({ label: p.label, value: applicable ? series[i][r.key] : null }));
    const value = applicable && last >= 0 ? series[last][r.key] : null;
    const own = history.map((h) => h.value).filter((v): v is number => v !== null);
    const raw = applicable && last >= 0 ? ratioNote(r.key, inputs[last], type) : null;
    // The ambiguity note only explains a number that is shown; a missing value says so itself.
    const note = raw === "revenueAmbiguous" && value === null ? null : raw;
    // With two competing revenue totals the company is left out of revenue-based sector
    // comparisons, exactly like ambiguous peers are.
    const comparable = applicable && value !== null && note !== "revenueAmbiguous";
    return {
      key: r.key,
      group: r.group,
      better: r.better,
      applicable,
      value,
      note,
      history,
      own: applicable && value !== null && own.length >= MIN_OWN_YEARS ? compare(own, value) : null,
      sector: comparable && sicInfo.sic ? sectorComparison(r.key, value!, sicInfo.sic, peers) : null,
    };
  });

  const p = periods[last];
  return {
    symbol,
    cik,
    businessType: type,
    ...sicInfo,
    period: p ? { label: p.label, end: p.end } : null,
    peersYear: peers.length ? peersYear : null,
    ratios,
  };
}

class RatiosError extends Error {
  constructor(readonly kind: DataIssue) {
    super(`ratios:${kind}`);
  }
}

// Only successful payloads are cached: an error is thrown out of the cache and turned back
// into a Result, so a transient SEC failure isn't remembered for hours.
const cachedRatios = unstable_cache(
  async (symbol: string): Promise<{ data: RatiosPayload; fetchedAt: string }> => {
    const db = getDb();
    if (!db) throw new RatiosError("not_configured");
    const r = await buildRatios(db, symbol);
    if (!r.ok) throw new RatiosError(r.error);
    return { data: r.data, fetchedAt: r.fetchedAt };
  },
  ["sec-ratios-v2"],
  { revalidate: 21_600, tags: ["sec"] },
);

export async function getRatios(symbol: string): Promise<Result<RatiosPayload>> {
  if (!getDb()) return { ok: false, error: "not_configured" };
  try {
    const { data, fetchedAt } = await cachedRatios(symbol);
    return { ok: true, data, fetchedAt };
  } catch (e) {
    if (e instanceof RatiosError) return { ok: false, error: e.kind };
    console.error(JSON.stringify({ event: "ratios_error", symbol, message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, error: "upstream" };
  }
}
