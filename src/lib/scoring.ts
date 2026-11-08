// Turns raw numbers into simple traffic-light verdicts.
// Text lives in the i18n dictionaries; this file only returns keys.
import type { AnnualIncome, Candle, Fundamentals } from "./types";
import { last, macd, rsi, sma } from "./indicators";

export type Level = "good" | "ok" | "bad" | "neutral";

export type MetricKey =
  | "pe" | "ps" | "pb" | "netMargin" | "grossMargin" | "roe"
  | "debtToEquity" | "currentRatio" | "dividendYield" | "revenueGrowth";

export interface MetricScore {
  key: MetricKey;
  value: number | undefined;
  level: Level;
  format: "x" | "pct";
}

/**
 * Fixed rules of thumb (heuristics), the same for every company and sector: [goodIf, badIf],
 * direction "low" means lower is better. The UI shows them next to every verdict.
 */
export const RULES: Record<MetricKey, { dir: "low" | "high"; good: number; bad: number; format: "x" | "pct" }> = {
  pe: { dir: "low", good: 15, bad: 30, format: "x" },
  ps: { dir: "low", good: 2, bad: 8, format: "x" },
  pb: { dir: "low", good: 3, bad: 10, format: "x" },
  netMargin: { dir: "high", good: 0.15, bad: 0.05, format: "pct" },
  grossMargin: { dir: "high", good: 0.4, bad: 0.2, format: "pct" },
  roe: { dir: "high", good: 0.15, bad: 0.08, format: "pct" },
  debtToEquity: { dir: "low", good: 1, bad: 2, format: "x" },
  currentRatio: { dir: "high", good: 1.5, bad: 1, format: "x" },
  dividendYield: { dir: "high", good: 0.02, bad: 0, format: "pct" },
  revenueGrowth: { dir: "high", good: 0.1, bad: 0, format: "pct" },
};

export function scoreMetric(key: MetricKey, value: number | undefined): MetricScore {
  const rule = RULES[key];
  let level: Level = "neutral";
  if (value !== undefined && Number.isFinite(value)) {
    if ((key === "pe" || key === "ps" || key === "pb") && value <= 0) level = "bad"; // losses / negative equity
    else if (key === "dividendYield") level = value > 0 ? "good" : "neutral"; // not paying isn't bad
    else if (rule.dir === "low") level = value <= rule.good ? "good" : value > rule.bad ? "bad" : "ok";
    else level = value >= rule.good ? "good" : value < rule.bad ? "bad" : "ok";
  }
  return { key, value, level, format: rule.format };
}

export function revenueGrowth(income: AnnualIncome[]): number | undefined {
  if (income.length < 2) return undefined;
  const a = income[income.length - 2].revenue;
  const b = income[income.length - 1].revenue;
  return a > 0 ? b / a - 1 : undefined;
}

export function scoreFundamentals(f: Fundamentals, income: AnnualIncome[]): MetricScore[] {
  const keys: [MetricKey, number | undefined][] = [
    ["pe", f.pe], ["ps", f.ps], ["pb", f.pb],
    ["revenueGrowth", revenueGrowth(income)],
    ["netMargin", f.netMargin], ["grossMargin", f.grossMargin], ["roe", f.roe],
    ["debtToEquity", f.debtToEquity], ["currentRatio", f.currentRatio],
    ["dividendYield", f.dividendYield],
  ];
  return keys.map(([k, v]) => scoreMetric(k, v)).filter((m) => m.value !== undefined);
}

export type SignalKey =
  | "rsiOverbought" | "rsiOversold" | "rsiNeutral"
  | "aboveSma200" | "belowSma200"
  | "goldenCross" | "deathCross" // a crossing event in the last CROSS_LOOKBACK sessions
  | "sma50Above200" | "sma50Below200" // the trend state when there was no recent crossing
  | "macdBull" | "macdBear";

export interface Signal {
  key: SignalKey;
  level: Level;
  value?: number;
  date?: string; // when the event happened (YYYY-MM-DD)
  days?: number; // sessions since the event
  close?: number; // last close the signal was computed on
  asOf?: string; // date of that close
}

export const CROSS_LOOKBACK = 30;

/**
 * Most recent crossing of the 50-day average over (golden) or under (death) the 200-day
 * average within the last `lookback` sessions. A golden cross is the crossing itself,
 * not the state "50 above 200", which can last for years.
 */
export function recentCross(
  history: Candle[],
  lookback = CROSS_LOOKBACK,
): { kind: "golden" | "death"; index: number } | null {
  const closes = history.map((c) => c.close);
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  for (let i = closes.length - 1; i >= Math.max(1, closes.length - lookback); i--) {
    const [a0, b0, a1, b1] = [s50[i - 1], s200[i - 1], s50[i], s200[i]];
    if (a0 == null || b0 == null || a1 == null || b1 == null) break;
    if (a0 <= b0 && a1 > b1) return { kind: "golden", index: i };
    if (a0 >= b0 && a1 < b1) return { kind: "death", index: i };
  }
  return null;
}

export function technicalSignals(history: Candle[]): Signal[] {
  const closes = history.map((c) => c.close);
  const out: Signal[] = [];
  const r = last(rsi(closes));
  if (r != null) {
    out.push(r >= 70 ? { key: "rsiOverbought", level: "bad", value: r }
      : r <= 30 ? { key: "rsiOversold", level: "good", value: r }
      : { key: "rsiNeutral", level: "neutral", value: r });
  }
  const s200 = last(sma(closes, 200));
  const s50 = last(sma(closes, 50));
  const price = closes[closes.length - 1];
  if (s200 != null) {
    const asOf = history[history.length - 1].time;
    out.push(price >= s200 ? { key: "aboveSma200", level: "good", value: s200, close: price, asOf } : { key: "belowSma200", level: "bad", value: s200, close: price, asOf });
  }
  if (s50 != null && s200 != null) {
    const cross = recentCross(history);
    if (cross) {
      const golden = cross.kind === "golden";
      out.push({
        key: golden ? "goldenCross" : "deathCross",
        level: golden ? "good" : "bad",
        date: history[cross.index].time,
        days: history.length - 1 - cross.index,
      });
    } else {
      out.push(s50 >= s200 ? { key: "sma50Above200", level: "good" } : { key: "sma50Below200", level: "bad" });
    }
  }
  const h = last(macd(closes).hist);
  if (h != null) out.push(h >= 0 ? { key: "macdBull", level: "good" } : { key: "macdBear", level: "bad" });
  return out;
}

export type SummaryKey =
  | "valCheap" | "valFair" | "valExpensive" | "valLoss"
  | "growFast" | "growSlow" | "growShrink"
  | "profitHigh" | "profitMid" | "profitLow"
  | "debtLow" | "debtMid" | "debtHigh"
  | "trendUp" | "trendDown";

export interface SummaryPoint {
  key: SummaryKey;
  level: Level;
  /** The number behind the sentence. */
  metric?: MetricKey;
  value?: number;
  /** For the trend: last close vs its 200-day average. */
  trend?: { close: number; sma200: number };
}

/** Metrics the summary tries to cover; the ones without data are listed, not hidden. */
export const SUMMARY_METRICS: MetricKey[] = ["pe", "revenueGrowth", "netMargin", "debtToEquity"];

export function missingSummaryMetrics(scores: MetricScore[]): MetricKey[] {
  return SUMMARY_METRICS.filter((k) => !scores.some((s) => s.key === k));
}

/** 3–5 plain-language bullets that sum up the stock. */
export function summarize(scores: MetricScore[], signals: Signal[]): SummaryPoint[] {
  const by = (k: MetricKey) => scores.find((s) => s.key === k);
  const out: SummaryPoint[] = [];
  const pe = by("pe");
  if (pe) {
    const key: SummaryKey = pe.value! <= 0 ? "valLoss" : pe.level === "good" ? "valCheap" : pe.level === "ok" ? "valFair" : "valExpensive";
    out.push({ key, level: pe.level, metric: "pe", value: pe.value });
  }
  const g = by("revenueGrowth");
  if (g) out.push({ key: g.level === "good" ? "growFast" : g.level === "ok" ? "growSlow" : "growShrink", level: g.level, metric: "revenueGrowth", value: g.value });
  const m = by("netMargin");
  if (m) out.push({ key: m.level === "good" ? "profitHigh" : m.level === "ok" ? "profitMid" : "profitLow", level: m.level, metric: "netMargin", value: m.value });
  const d = by("debtToEquity");
  if (d) out.push({ key: d.level === "good" ? "debtLow" : d.level === "ok" ? "debtMid" : "debtHigh", level: d.level, metric: "debtToEquity", value: d.value });
  const t = signals.find((s) => s.key === "aboveSma200" || s.key === "belowSma200");
  if (t) out.push({ key: t.key === "aboveSma200" ? "trendUp" : "trendDown", level: t.level, trend: t.close !== undefined && t.value !== undefined ? { close: t.close, sma200: t.value } : undefined });
  return out;
}
