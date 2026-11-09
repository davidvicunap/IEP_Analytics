// Chart generator: what can be plotted, and how series are built and transformed.
// Pure (no I/O): runs on the server (building series from SEC statements) and in the
// browser (aligning companies, growth and index transforms).
import { splitFactors } from "./quality";
import { TAX_RATE } from "./ratios";
import type { LineKey, SharesHistory, StatementSet } from "./secFinancials";

export type Freq = "annual" | "quarterly" | "monthly";
export type Unit = "usd" | "perShare" | "pct" | "multiple" | "count";
export type Transform = "values" | "growth" | "index";

export type FundamentalKey =
  | "revenue" | "grossProfit" | "operatingIncome" | "ebitda" | "netIncome"
  | "operatingCashFlow" | "capex" | "freeCashFlow" | "dividendsPaid" | "buybacks"
  | "cash" | "debt" | "equity" | "totalAssets"
  | "eps" | "fcfPerShare" | "bookValuePerShare" | "dividendsPerShare"
  | "grossMargin" | "operatingMargin" | "netMargin" | "fcfMargin"
  | "roe" | "roa" | "roic" | "debtToEquity" | "shares";
export type MarketKey = "price" | "marketCap" | "pe" | "ps" | "pb" | "evEbitda" | "fcfYield";
export type ChartMetric = FundamentalKey | MarketKey;

export type MetricGroup = "income" | "cash" | "balance" | "perShare" | "margins" | "returns" | "market" | "valuation";

export interface MetricDef {
  key: ChartMetric;
  group: MetricGroup;
  unit: Unit;
  freqs: Freq[];
}

const FQ: Freq[] = ["annual", "quarterly"];
const A: Freq[] = ["annual"];
const M: Freq[] = ["monthly"];

export const METRICS: MetricDef[] = [
  { key: "revenue", group: "income", unit: "usd", freqs: FQ },
  { key: "grossProfit", group: "income", unit: "usd", freqs: FQ },
  { key: "operatingIncome", group: "income", unit: "usd", freqs: FQ },
  { key: "ebitda", group: "income", unit: "usd", freqs: FQ },
  { key: "netIncome", group: "income", unit: "usd", freqs: FQ },
  { key: "operatingCashFlow", group: "cash", unit: "usd", freqs: FQ },
  { key: "capex", group: "cash", unit: "usd", freqs: FQ },
  { key: "freeCashFlow", group: "cash", unit: "usd", freqs: FQ },
  { key: "dividendsPaid", group: "cash", unit: "usd", freqs: FQ },
  { key: "buybacks", group: "cash", unit: "usd", freqs: FQ },
  { key: "cash", group: "balance", unit: "usd", freqs: FQ },
  { key: "debt", group: "balance", unit: "usd", freqs: FQ },
  { key: "equity", group: "balance", unit: "usd", freqs: FQ },
  { key: "totalAssets", group: "balance", unit: "usd", freqs: FQ },
  { key: "shares", group: "balance", unit: "count", freqs: FQ },
  { key: "eps", group: "perShare", unit: "perShare", freqs: FQ },
  { key: "fcfPerShare", group: "perShare", unit: "perShare", freqs: FQ },
  { key: "bookValuePerShare", group: "perShare", unit: "perShare", freqs: FQ },
  { key: "dividendsPerShare", group: "perShare", unit: "perShare", freqs: FQ },
  { key: "grossMargin", group: "margins", unit: "pct", freqs: FQ },
  { key: "operatingMargin", group: "margins", unit: "pct", freqs: FQ },
  { key: "netMargin", group: "margins", unit: "pct", freqs: FQ },
  { key: "fcfMargin", group: "margins", unit: "pct", freqs: FQ },
  // Returns need a full year of profit against a balance: annual only.
  { key: "roe", group: "returns", unit: "pct", freqs: A },
  { key: "roa", group: "returns", unit: "pct", freqs: A },
  { key: "roic", group: "returns", unit: "pct", freqs: A },
  { key: "debtToEquity", group: "returns", unit: "multiple", freqs: FQ },
  { key: "price", group: "market", unit: "perShare", freqs: M },
  { key: "marketCap", group: "market", unit: "usd", freqs: M },
  { key: "pe", group: "valuation", unit: "multiple", freqs: M },
  { key: "ps", group: "valuation", unit: "multiple", freqs: M },
  { key: "pb", group: "valuation", unit: "multiple", freqs: M },
  { key: "evEbitda", group: "valuation", unit: "multiple", freqs: M },
  { key: "fcfYield", group: "valuation", unit: "pct", freqs: M },
];
export const METRIC_KEYS = new Set<ChartMetric>(METRICS.map((m) => m.key));
export const metricDef = (k: ChartMetric) => METRICS.find((m) => m.key === k)!;
export const GROUPS: MetricGroup[] = ["income", "cash", "balance", "perShare", "margins", "returns", "market", "valuation"];
export const MARKET_KEYS: MarketKey[] = ["price", "marketCap", "pe", "ps", "pb", "evEbitda", "fcfYield"];

/** One company's values for one frequency: `keys` sort chronologically and align across companies. */
export interface PeriodSeries {
  keys: string[]; // "FY2024" (fiscal year) · "2024-Q3" (calendar quarter) · "2024-07" (month)
  ends: string[]; // period end dates (YYYY-MM-DD)
  values: Partial<Record<ChartMetric, (number | null)[]>>;
}

/** Calendar quarter of a period end ("2024-Q3"). Ends a few days into a month count for the month before. */
export function calendarQuarter(end: string): string {
  const d = new Date(Date.parse(end) - 10 * 86_400_000);
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

const nonNeg = (x: number | null) => (x === null ? null : Math.abs(x));
const ratio = (a: number | null, b: number | null) => (a !== null && b !== null && b > 0 ? a / b : null);

/** Every fundamental metric for every period of a statement set, per-share figures split-adjusted. */
export function fundamentalSeries(set: StatementSet, splits: SharesHistory["splits"], freq: "annual" | "quarterly"): PeriodSeries {
  const f = splitFactors(set, splits);
  const v = (k: LineKey, i: number) => {
    const x = set.lines[k]?.[i]?.value;
    return typeof x === "number" && Number.isFinite(x) ? x : null;
  };
  const out: Record<FundamentalKey, (number | null)[]> = Object.fromEntries(
    METRICS.filter((m) => m.group !== "market" && m.group !== "valuation").map((m) => [m.key, []]),
  ) as unknown as Record<FundamentalKey, (number | null)[]>;
  const keys: string[] = [];
  const ends: string[] = [];
  const seen = new Set<string>();
  set.periods.forEach((p, i) => {
    const key = freq === "annual" ? p.label : calendarQuarter(p.end);
    if (seen.has(key)) return; // two periods in one calendar quarter: keep the first
    seen.add(key);
    keys.push(key);
    ends.push(p.end);
    const revenue = v("revenue", i);
    const cost = v("costOfRevenue", i);
    const gross = v("grossProfit", i) ?? (revenue !== null && cost !== null ? revenue - cost : null);
    const op = v("operatingIncome", i);
    const ni = v("netIncome", i);
    const dep = v("depreciation", i);
    const ocf = v("operatingCashFlow", i);
    const capex = nonNeg(v("capex", i));
    const fcf = v("freeCashFlow", i) ?? (ocf !== null && capex !== null ? ocf - capex : null);
    const ltd = v("longTermDebt", i);
    const std = v("currentDebt", i);
    const debt = ltd === null && std === null ? null : (ltd ?? 0) + (std ?? 0);
    const equity = v("equity", i);
    const assets = v("totalAssets", i);
    const rawShares = v("dilutedShares", i);
    const shares = rawShares === null ? null : rawShares * f[i];
    const rawEps = v("epsDiluted", i);
    const divs = nonNeg(v("dividendsPaid", i));
    const row: Record<FundamentalKey, number | null> = {
      revenue,
      grossProfit: gross,
      operatingIncome: op,
      ebitda: op !== null && dep !== null ? op + dep : null,
      netIncome: ni,
      operatingCashFlow: ocf,
      capex,
      freeCashFlow: fcf,
      dividendsPaid: divs,
      buybacks: nonNeg(v("buybacks", i)),
      cash: v("cash", i),
      debt,
      equity,
      totalAssets: assets,
      shares,
      eps: rawEps === null ? null : rawEps / f[i],
      fcfPerShare: ratio(fcf, shares),
      bookValuePerShare: ratio(equity, shares),
      dividendsPerShare: ratio(divs, shares),
      grossMargin: ratio(gross, revenue),
      operatingMargin: ratio(op, revenue),
      netMargin: ratio(ni, revenue),
      fcfMargin: ratio(fcf, revenue),
      roe: freq === "annual" ? ratio(ni, equity) : null,
      roa: freq === "annual" ? ratio(ni, assets) : null,
      roic: freq === "annual" && op !== null && equity !== null && ltd !== null ? ratio(op * (1 - TAX_RATE), equity + ltd) : null,
      debtToEquity: ratio(debt, equity),
    };
    for (const k of Object.keys(out) as FundamentalKey[]) out[k].push(row[k]);
  });
  return { keys, ends, values: out };
}

// ---- Combining companies ------------------------------------------------------------------

export interface SeriesSpec {
  id: string; // "AAPL:revenue"
  symbol: string;
  metric: ChartMetric;
}

export interface ChartData {
  categories: string[]; // aligned period keys, oldest first
  series: { spec: SeriesSpec; values: (number | null)[] }[];
  unit: Unit | "index";
}

/** Growth against the matching earlier period (previous year, same quarter last year, 12 months before). */
function growthAt(values: (number | null)[], i: number, freq: Freq): number | null {
  const lag = freq === "annual" ? 1 : freq === "quarterly" ? 4 : 12;
  const a = values[i - lag];
  const b = values[i];
  return a != null && b != null && a > 0 ? b / a - 1 : null;
}

/**
 * Aligns the selected series on one period axis, keeps the last `range` periods, then
 * applies the transform. Growth uses the periods before the window, so the first visible
 * point has a value; the index is based on each series' first positive value in the window.
 */
export function buildChartData(
  specs: SeriesSpec[],
  bySymbol: Record<string, PeriodSeries | undefined>,
  freq: Freq,
  transform: Transform,
  range: number,
): ChartData {
  const all = new Set<string>();
  for (const s of specs) bySymbol[s.symbol]?.keys.forEach((k) => all.add(k));
  const sorted = [...all].sort(comparePeriodKeys);
  const categories = range > 0 ? sorted.slice(-range) : sorted;
  const offset = sorted.length - categories.length;
  const series = specs.map((spec) => {
    const src = bySymbol[spec.symbol];
    const raw = src?.values[spec.metric] ?? [];
    const pos = new Map(src?.keys.map((k, i) => [k, i]) ?? []);
    const full = sorted.map((k) => (pos.has(k) ? (raw[pos.get(k)!] ?? null) : null));
    let values: (number | null)[];
    if (transform === "growth") values = categories.map((_, j) => growthAt(full, offset + j, freq));
    else if (transform === "index") {
      const win = full.slice(offset);
      const base = win.find((x) => x != null && x > 0) ?? null;
      values = win.map((x) => (x != null && base ? (x / base) * 100 : null));
    } else values = full.slice(offset);
    return { spec, values };
  });
  const unit = transform === "growth" ? "pct" : transform === "index" ? "index" : (metricDef(specs[0]?.metric ?? "revenue").unit);
  return { categories, series, unit };
}

/** "FY2019" < "FY2024"; "2023-Q4" < "2024-Q1"; "2024-01" < "2024-12". */
export function comparePeriodKeys(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}

/** Units must match to share one axis, unless every series is turned into growth or an index. */
export function compatible(metrics: ChartMetric[], transform: Transform): boolean {
  if (transform !== "values") return true;
  return new Set(metrics.map((m) => metricDef(m).unit)).size <= 1;
}

/** Round tick steps (1, 2, 5 × 10^n) covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.abs(v) < step / 1e6 ? 0 : +v.toPrecision(12));
  return out;
}

export const MAX_SYMBOLS = 5;
export const MAX_METRICS = 3;
export const MAX_SERIES = 6;
export const RANGES: Record<Freq, number[]> = { annual: [5, 10, 0], quarterly: [8, 12, 24], monthly: [12, 36, 60] };
