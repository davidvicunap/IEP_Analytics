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

/** Thresholds: [goodIf, badIf] — direction "low" means lower is better. */
const RULES: Record<MetricKey, { dir: "low" | "high"; good: number; bad: number; format: "x" | "pct" }> = {
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
  | "goldenCross" | "deathCross"
  | "macdBull" | "macdBear";

export interface Signal {
  key: SignalKey;
  level: Level;
  value?: number;
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
    out.push(price >= s200 ? { key: "aboveSma200", level: "good", value: s200 } : { key: "belowSma200", level: "bad", value: s200 });
  }
  if (s50 != null && s200 != null) {
    out.push(s50 >= s200 ? { key: "goldenCross", level: "good" } : { key: "deathCross", level: "bad" });
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
}

/** 3–5 plain-language bullets that sum up the stock. */
export function summarize(scores: MetricScore[], signals: Signal[]): SummaryPoint[] {
  const by = (k: MetricKey) => scores.find((s) => s.key === k);
  const out: SummaryPoint[] = [];
  const pe = by("pe");
  if (pe) {
    const key: SummaryKey = pe.value! <= 0 ? "valLoss" : pe.level === "good" ? "valCheap" : pe.level === "ok" ? "valFair" : "valExpensive";
    out.push({ key, level: pe.level });
  }
  const g = by("revenueGrowth");
  if (g) out.push({ key: g.level === "good" ? "growFast" : g.level === "ok" ? "growSlow" : "growShrink", level: g.level });
  const m = by("netMargin");
  if (m) out.push({ key: m.level === "good" ? "profitHigh" : m.level === "ok" ? "profitMid" : "profitLow", level: m.level });
  const d = by("debtToEquity");
  if (d) out.push({ key: d.level === "good" ? "debtLow" : d.level === "ok" ? "debtMid" : "debtHigh", level: d.level });
  const t = signals.find((s) => s.key === "aboveSma200" || s.key === "belowSma200");
  if (t) out.push({ key: t.key === "aboveSma200" ? "trendUp" : "trendDown", level: t.level });
  return out;
}
