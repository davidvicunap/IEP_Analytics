// "At a glance": one short verdict per question an investor asks first (is it a good
// business, is it growing, is it profitable, how much debt, how is it valued), every one
// measured the same way the rest of the app measures it:
// - quality: the Buffett tests on 10 years of 10-Ks;
// - growth, profitability and debt: against the company's own SEC industry group;
// - valuation: today's multiple against the company's own 5-year history.
// No fixed "good P/E" rules of thumb. Pure: the inputs are read in verdictData.ts.
import type { QualityLevel } from "./quality";
import type { BusinessType, RatioKey } from "./ratios";
import type { HistoryAnalysis, MultipleKey } from "./valuation";

export const VERDICT_KEYS = ["quality", "growth", "profitability", "debt", "valuation"] as const;
export type VerdictKey = (typeof VERDICT_KEYS)[number];
export type VerdictLevel = "good" | "mid" | "weak";

export interface VerdictPoint {
  key: VerdictKey;
  level: VerdictLevel;
  /** Which figure the sentence quotes (a ratio or a multiple). */
  metric?: RatioKey | MultipleKey;
  value?: number;
  /** The yardstick: the industry median or the company's own 5-year average. */
  compare?: number;
  peers?: number; // companies in the industry comparison
  passed?: number;
  judged?: number;
  cagr5?: number | null; // growth only: 5-year revenue growth rate
  note?: "negativeEquity";
}

interface RatioIn {
  key: RatioKey;
  applicable: boolean;
  value: number | null;
  note: string | null;
  sector: { percentile: number; median: number; n: number } | null;
}

export interface VerdictInputs {
  quality: { passed: number; failed: number; level: QualityLevel; revenueCagr5: number | null } | null;
  ratios: { businessType: BusinessType; rows: RatioIn[] } | null;
  valuation: HistoryAnalysis | null;
}

/** Thirds of the industry: top third good, bottom third weak ("better" says which end is the top). */
export function tercile(percentile: number, better: "higher" | "lower"): VerdictLevel {
  const p = better === "higher" ? percentile : 100 - percentile;
  return p >= 67 ? "good" : p <= 33 ? "weak" : "mid";
}

function sectorPoint(key: VerdictKey, r: RatioIn | undefined, better: "higher" | "lower", extra: Partial<VerdictPoint> = {}): VerdictPoint | null {
  if (!r || !r.applicable || r.value === null || !r.sector) return null;
  return { key, level: tercile(r.sector.percentile, better), metric: r.key, value: r.value, compare: r.sector.median, peers: r.sector.n, ...extra };
}

export function buildVerdict(i: VerdictInputs): { points: VerdictPoint[]; missing: VerdictKey[] } {
  const points: VerdictPoint[] = [];
  const row = (k: RatioKey) => i.ratios?.rows.find((r) => r.key === k && r.applicable);

  // Quality: needs at least 4 tests that could be judged (the same rule as the Business tab).
  const q = i.quality;
  if (q && q.level !== "na") {
    points.push({ key: "quality", level: q.level === "high" ? "good" : q.level === "mixed" ? "mid" : "weak", passed: q.passed, judged: q.passed + q.failed });
  }

  // Growth: revenue against the industry; banks and insurers have no comparable revenue, so EPS.
  const growth = sectorPoint("growth", row("revenueGrowth") ?? row("epsGrowth"), "higher", { cagr5: q?.revenueCagr5 ?? null });
  if (growth) points.push(growth);

  // Profitability: return on capital (ROIC); financials, return on equity.
  const profit = sectorPoint("profitability", row("roic") ?? row("roe"), "higher");
  if (profit) points.push(profit);

  // Debt: long-term debt to equity; banks and insurers, equity to assets (more is safer).
  const de = i.ratios?.rows.find((r) => r.key === "debtToEquity");
  if (de?.applicable && de.note === "negativeEquity") points.push({ key: "debt", level: "weak", metric: "debtToEquity", note: "negativeEquity" });
  else {
    const debt = row("debtToEquity") ? sectorPoint("debt", row("debtToEquity"), "lower") : sectorPoint("debt", row("equityToAssets"), "higher");
    if (debt) points.push(debt);
  }

  // Valuation: against its own 5-year history only (never "cheap" against other companies).
  const v = i.valuation;
  if (v) points.push({ key: "valuation", level: v.verdict === "cheap" ? "good" : v.verdict === "expensive" ? "weak" : "mid", metric: v.key, value: v.current, compare: v.mean });

  const have = new Set(points.map((p) => p.key));
  return { points, missing: VERDICT_KEYS.filter((k) => !have.has(k)) };
}

/** The multiple a company is judged on: P/E when it has profits, else sales; book value for financials. */
export function valuationKey(type: BusinessType, has: (k: MultipleKey) => boolean): MultipleKey | null {
  const order: MultipleKey[] = type === "bank" || type === "insurance" ? ["pe", "pb"] : type === "reit" ? ["ps", "pb"] : ["pe", "ps"];
  return order.find(has) ?? null;
}
