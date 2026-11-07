// Server-side: long-term quality, growth and 10-year trends for a ticker, from SEC annual
// statements (public domain, so this is served outside the beta gate).
import { unstable_cache } from "next/cache";
import { getDb } from "@/db/client";
import { getFinancials, type FinancialsPayload } from "./financials";
import { ensureSic } from "./peers";
import {
  assessQuality, bookValuePerShareOf, fcfMarginOf, grossMarginOf, netMarginOf, operatingMarginOf, roaOf, roeOf, roicOf,
  splitFactors, type GrowthKey, type QualityCheck, type QualityLevel, type YearRow,
} from "./quality";
import { businessType, type BusinessType } from "./ratios";
import type { DataIssue, Result } from "./types";

export type TrendKey =
  | "revenue" | "netIncome" | "fcf" | "eps" | "bookValue"
  | "grossMargin" | "operatingMargin" | "netMargin" | "fcfMargin" | "roic" | "roe" | "roa" | "shares";

const TRENDS: Record<BusinessType, TrendKey[]> = {
  general: ["revenue", "netIncome", "fcf", "eps", "grossMargin", "operatingMargin", "netMargin", "fcfMargin", "roic", "shares"],
  bank: ["netIncome", "eps", "bookValue", "roe", "roa", "shares"],
  insurance: ["netIncome", "eps", "bookValue", "roe", "shares"],
  reit: ["revenue", "netIncome", "fcf", "operatingMargin", "shares"],
};

const SERIES: Record<TrendKey, (r: YearRow) => number | null> = {
  revenue: (r) => r.revenue,
  netIncome: (r) => r.netIncome,
  fcf: (r) => r.fcf,
  eps: (r) => r.eps,
  bookValue: bookValuePerShareOf,
  grossMargin: grossMarginOf,
  operatingMargin: operatingMarginOf,
  netMargin: netMarginOf,
  fcfMargin: fcfMarginOf,
  roic: roicOf,
  roe: roeOf,
  roa: roaOf,
  shares: (r) => r.shares,
};

export interface QualityPayload {
  symbol: string;
  cik: number;
  name: string;
  businessType: BusinessType;
  years: { label: string; end: string; accn?: string; form?: string }[]; // the fiscal years the checks use
  checks: QualityCheck[];
  summary: { passed: number; failed: number; na: number; level: QualityLevel };
  growth: { key: GrowthKey; cagr: Record<3 | 5 | 10, number | null> }[];
  trends: { key: TrendKey; values: (number | null)[] }[];
  splitAdjusted: boolean; // per-share figures before a stock split were restated to today's basis
  lastFiscal: { label: string; end: string; revenue: number | null; eps: number | null } | null;
}

class QualityError extends Error {
  constructor(readonly kind: DataIssue) {
    super(`quality:${kind}`);
  }
}

/** The payload for statements already loaded (pure: no I/O). */
export function qualityPayload(
  fin: Pick<FinancialsPayload, "symbol" | "cik" | "entityName" | "annual" | "shares">,
  type: BusinessType,
): QualityPayload {
  const { annual, shares } = fin;
  const { rows, checks, summary, growth } = assessQuality(annual, shares.splits, type);
  const periods = annual.periods.slice(-rows.length);
  const last = rows[rows.length - 1];
  return {
    symbol: fin.symbol,
    cik: fin.cik,
    name: fin.entityName,
    businessType: type,
    years: periods.map((p) => ({ label: p.label, end: p.end, accn: p.accn, form: p.form })),
    checks,
    summary,
    growth,
    trends: TRENDS[type].map((key) => ({ key, values: rows.map(SERIES[key]) })),
    splitAdjusted: splitFactors(annual, shares.splits).slice(-rows.length).some((f) => f !== 1),
    lastFiscal: last ? { label: last.label, end: last.end, revenue: last.revenue, eps: last.eps } : null,
  };
}

async function buildQuality(symbol: string): Promise<{ data: QualityPayload; fetchedAt: string }> {
  const db = getDb();
  if (!db) throw new QualityError("not_configured");
  const fin = await getFinancials(symbol);
  if (!fin.ok) throw new QualityError(fin.error);
  if (fin.data.annual.periods.length === 0) throw new QualityError("not_found");

  let sic: number | null = null;
  try {
    sic = (await ensureSic(db, fin.data.cik)).sic;
  } catch (e) {
    console.error(JSON.stringify({ event: "quality_sic_error", symbol, message: e instanceof Error ? e.message : String(e) }));
  }
  return { data: qualityPayload(fin.data, businessType(sic)), fetchedAt: fin.fetchedAt };
}

// Only successful payloads are cached; errors are thrown out of the cache and retried.
const cachedQuality = unstable_cache(buildQuality, ["sec-quality-v1"], { revalidate: 21_600, tags: ["sec"] });

export async function getQuality(symbol: string): Promise<Result<QualityPayload>> {
  if (!getDb()) return { ok: false, error: "not_configured" };
  try {
    const { data, fetchedAt } = await cachedQuality(symbol);
    return { ok: true, data, fetchedAt };
  } catch (e) {
    if (e instanceof QualityError) return { ok: false, error: e.kind };
    console.error(JSON.stringify({ event: "quality_error", symbol, message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, error: "upstream" };
  }
}
