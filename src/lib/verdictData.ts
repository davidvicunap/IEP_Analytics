// Server-side: the inputs of "At a glance". Business figures come from SEC filings (quality
// tests, ratios against the industry); valuation uses the quote and the same daily price
// history as the chart (both already cached for the page), so this adds no FMP calls.
import { getQuote, isDemo } from "./data";
import { getFinancials } from "./financials";
import { fmpHistory } from "./fmp";
import { getQuality } from "./qualityData";
import { getRatios } from "./ratiosData";
import type { DataIssue, Result } from "./types";
import { MULTIPLES, analyzeHistory, multipleHistory, multiplesFor, sharesConsistency, ttmAt, ttmSeries, type HistoryAnalysis, type MultipleKey } from "./valuation";
import { buildVerdict, valuationKey, type VerdictKey, type VerdictPoint } from "./verdict";

const SHARES_TOLERANCE = 0.1; // same rule as the Valuation tab

export interface VerdictPayload {
  symbol: string;
  points: VerdictPoint[];
  missing: VerdictKey[];
  /** Fiscal year of the business figures, and the industry the comparisons use. */
  fiscal: string | null;
  industry: string | null;
  /** When the valuation line's price was taken, and the 5-year window it's compared with. */
  priceAt: string | null;
  historyFrom: string | null;
  issues: Partial<Record<"business" | "valuation", DataIssue>>;
}

interface ValuationPart {
  analyses: Map<MultipleKey, HistoryAnalysis>; // every multiple with enough history
  priceAt: string | null;
  issue: DataIssue | null;
}

async function valuation(symbol: string): Promise<ValuationPart> {
  const none = (issue: DataIssue | null, priceAt: string | null = null): ValuationPart => ({ analyses: new Map(), priceAt, issue });
  if (isDemo()) return none("not_configured"); // never mix simulated prices with real filings
  const [quote, fin] = await Promise.all([getQuote(symbol), getFinancials(symbol)]);
  if (!quote.ok) return none(quote.error);
  if (!fin.ok) return none(fin.error);
  const { price, marketCap } = quote.data;
  const priceAt = quote.data.asOf ?? quote.fetchedAt;
  if (!(price > 0) || !(marketCap && marketCap > 0)) return none("not_found", priceAt);
  // Share classes or a stale count: the history would be wrong, so no valuation line (not an error).
  const ratio = sharesConsistency(fin.data.shares, marketCap, price);
  if (ratio === null || Math.abs(ratio - 1) > SHARES_TOLERANCE) return none(null, priceAt);
  const prices = await fmpHistory(symbol);
  if (!prices.ok) return none(prices.error, priceAt);
  const series = ttmSeries(fin.data.quarterly);
  const now = multiplesFor(marketCap, ttmAt(series, new Date().toISOString().slice(0, 10)));
  const hist = multipleHistory(prices.data, fin.data.shares, series);
  const analyses = new Map<MultipleKey, HistoryAnalysis>();
  for (const m of MULTIPLES) {
    const v = now[m.key];
    if (v === null || !(v > 0)) continue;
    const a = analyzeHistory(hist, m.key, v, price, m.higherIsCheaper);
    if (a) analyses.set(m.key, a);
  }
  return { analyses, priceAt, issue: null };
}

export async function getVerdict(symbol: string): Promise<Result<VerdictPayload>> {
  const [quality, ratios, val] = await Promise.all([getQuality(symbol), getRatios(symbol), valuation(symbol)]);
  const businessIssue = !quality.ok && !ratios.ok ? ratios.error : null;
  const analyses = val.analyses;
  const type = ratios.ok ? ratios.data.businessType : quality.ok ? quality.data.businessType : "general";
  const key = valuationKey(type, (k) => analyses.has(k));
  const revenueCagr5 = quality.ok ? (quality.data.growth.find((g) => g.key === "revenue")?.cagr[5] ?? null) : null;

  const { points, missing } = buildVerdict({
    quality: quality.ok ? { ...quality.data.summary, revenueCagr5 } : null,
    ratios: ratios.ok ? { businessType: ratios.data.businessType, rows: ratios.data.ratios } : null,
    valuation: key ? analyses.get(key)! : null,
  });
  if (!points.length) return { ok: false, error: businessIssue ?? val.issue ?? "not_found" };

  const issues: VerdictPayload["issues"] = {};
  if (businessIssue) issues.business = businessIssue;
  if (val.issue) issues.valuation = val.issue;
  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    data: {
      symbol,
      points,
      missing,
      fiscal: ratios.ok ? (ratios.data.period?.label ?? null) : quality.ok ? (quality.data.lastFiscal?.label ?? null) : null,
      industry: ratios.ok ? ratios.data.sicDescription : null,
      priceAt: key ? val.priceAt : null,
      historyFrom: key ? analyses.get(key)!.from : null,
      issues,
    },
  };
}
