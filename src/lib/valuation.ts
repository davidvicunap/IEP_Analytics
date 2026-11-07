// Valuation multiples from SEC fundamentals and market prices. Pure functions: the server
// assembles the inputs (valuationData.ts) and the same code runs in tests.
import { median, percentileRank, type BusinessType, type RatioInputs } from "./ratios";
import type { LineKey, SharesHistory, StatementSet } from "./secFinancials";

export type MultipleKey = "pe" | "ps" | "pb" | "fcfYield";
export type MultipleNote = "loss" | "negativeEquity" | "negativeFcf" | "revenueAmbiguous";

export interface MultipleDef {
  key: MultipleKey;
  appliesTo: BusinessType[];
  /** true when a higher value means a cheaper stock (yields), false for price multiples. */
  higherIsCheaper: boolean;
}

// Banks and insurers are valued on earnings and book value; REITs on assets and cash flow
// (FFO isn't in standard XBRL, and net income understates REIT earnings because of depreciation).
export const MULTIPLES: MultipleDef[] = [
  { key: "pe", appliesTo: ["general", "bank", "insurance"], higherIsCheaper: false },
  { key: "ps", appliesTo: ["general", "reit"], higherIsCheaper: false },
  { key: "pb", appliesTo: ["general", "bank", "insurance", "reit"], higherIsCheaper: false },
  { key: "fcfYield", appliesTo: ["general", "reit"], higherIsCheaper: true },
];

/** Trailing twelve months ending at a quarter; balance-sheet values at that quarter end. */
export interface Ttm {
  end: string;
  filed: string; // when the last of the four quarters became public
  label: string;
  revenue?: number;
  netIncome?: number;
  fcf?: number;
  equity?: number;
  revenueAmbiguous?: boolean;
  // for the DCF maker
  ebit?: number;
  da?: number;
  capex?: number;
  incomeTax?: number;
  pretaxIncome?: number;
  interestExpense?: number;
  cash?: number;
  debt?: number; // long + short term at the last quarter end
}

const DAY = 86_400_000;
const quarterApart = (a: string, b: string) => {
  const d = (Date.parse(b) - Date.parse(a)) / DAY;
  return d >= 80 && d <= 100;
};

/** TTM figures for every run of four consecutive quarters. */
export function ttmSeries(q: StatementSet): Ttm[] {
  const out: Ttm[] = [];
  const value = (k: LineKey, i: number) => q.lines[k]?.[i]?.value ?? null;
  for (let i = 3; i < q.periods.length; i++) {
    const idx = [i - 3, i - 2, i - 1, i];
    if (!idx.slice(1).every((j, k) => quarterApart(q.periods[idx[k]].end, q.periods[j].end))) continue;
    const sum = (k: LineKey) => {
      const vals = idx.map((j) => value(k, j));
      return vals.every((v) => v !== null) ? vals.reduce((a, b) => a + b!, 0) : undefined;
    };
    const p = q.periods[i];
    const t: Ttm = {
      end: p.end,
      filed: p.filed ?? p.end,
      label: p.label,
      revenue: sum("revenue"),
      netIncome: sum("netIncome"),
      fcf: sum("freeCashFlow"),
      equity: value("equity", i) ?? undefined,
      revenueAmbiguous: idx.some((j) => !!q.lines.revenue?.[j]?.alt) || undefined,
      ebit: sum("operatingIncome"),
      da: sum("depreciation"),
      capex: sum("capex"),
      incomeTax: sum("incomeTax"),
      pretaxIncome: sum("pretaxIncome"),
      interestExpense: sum("interestExpense"),
      cash: value("cash", i) ?? undefined,
      debt: value("longTermDebt", i) !== null || value("currentDebt", i) !== null ? (value("longTermDebt", i) ?? 0) + (value("currentDebt", i) ?? 0) : undefined,
    };
    for (const k of Object.keys(t) as (keyof Ttm)[]) if (t[k] === undefined) delete t[k];
    out.push(t);
  }
  return out;
}

/** The latest TTM that was public on `date` (no look-ahead into later filings). */
export function ttmAt(series: Ttm[], date: string): Ttm | undefined {
  let best: Ttm | undefined;
  for (const t of series) if (t.filed <= date && (!best || t.end > best.end)) best = t;
  return best;
}

/** Cover-page share counts restated to today's share basis (after every later split). */
export function adjustedShares(sh: SharesHistory): { end: string; value: number }[] {
  return sh.points
    .filter((p) => !sh.reliableFrom || p.end >= sh.reliableFrom)
    .map((p) => ({
      end: p.end,
      value: p.value * sh.splits.filter((s) => s.after >= p.end).reduce((m, s) => m * s.ratio, 1),
    }));
}

export function sharesAt(adj: { end: string; value: number }[], date: string): number | undefined {
  let best: { end: string; value: number } | undefined;
  for (const p of adj) if (p.end <= date && (!best || p.end > best.end)) best = p;
  return best?.value;
}

export function multiplesFor(marketCap: number, t: Ttm | undefined): Record<MultipleKey, number | null> {
  const pos = (v: number | undefined) => (v !== undefined && v > 0 ? v : null);
  const ni = pos(t?.netIncome);
  const rev = pos(t?.revenue);
  const eq = pos(t?.equity);
  return {
    pe: ni ? marketCap / ni : null,
    ps: rev ? marketCap / rev : null,
    pb: eq ? marketCap / eq : null,
    fcfYield: t?.fcf !== undefined && marketCap > 0 ? t.fcf / marketCap : null,
  };
}

/** Why a multiple is missing or needs care. */
export function multipleNote(key: MultipleKey, t: Ttm | undefined): MultipleNote | null {
  if (!t) return null;
  if (key === "pe" && t.netIncome !== undefined && t.netIncome <= 0) return "loss";
  if (key === "pb" && t.equity !== undefined && t.equity <= 0) return "negativeEquity";
  if (key === "fcfYield" && t.fcf !== undefined && t.fcf < 0) return "negativeFcf";
  if (key === "ps" && t.revenueAmbiguous) return "revenueAmbiguous";
  return null;
}

export interface Candle {
  time: string;
  close: number;
}

export interface HistoryPoint {
  date: string;
  marketCap: number;
  values: Record<MultipleKey, number | null>;
}

/**
 * Month-end multiples: split-adjusted close × shares on that date, over the TTM figures that
 * were public then. Months before the first share count are skipped.
 */
export function multipleHistory(candles: Candle[], shares: SharesHistory, ttm: Ttm[]): HistoryPoint[] {
  const adj = adjustedShares(shares);
  const lastOfMonth = new Map<string, Candle>();
  for (const c of candles) lastOfMonth.set(c.time.slice(0, 7), c); // candles are oldest → newest
  const out: HistoryPoint[] = [];
  for (const c of lastOfMonth.values()) {
    const n = sharesAt(adj, c.time);
    if (!n || !(c.close > 0)) continue;
    const marketCap = c.close * n;
    out.push({ date: c.time, marketCap, values: multiplesFor(marketCap, ttmAt(ttm, c.time)) });
  }
  return out;
}

/** Share count implied by the quote vs the latest SEC count, as a ratio (1 = identical). */
export function sharesConsistency(shares: SharesHistory, marketCap: number, price: number): number | null {
  const adj = adjustedShares(shares);
  const last = adj.at(-1);
  if (!last || !(price > 0) || !(marketCap > 0)) return null;
  return marketCap / price / last.value;
}

export interface HistoryStats {
  percentile: number;
  median: number;
  min: number;
  max: number;
  n: number; // months with a value
  from: string;
}

export const MIN_HISTORY_MONTHS = 24;

export function historyStats(history: HistoryPoint[], key: MultipleKey, current: number): HistoryStats | null {
  const pts = history.filter((h) => h.values[key] !== null);
  if (pts.length < MIN_HISTORY_MONTHS) return null;
  const values = pts.map((h) => h.values[key]!);
  return {
    percentile: percentileRank(values, current)!,
    median: median(values)!,
    min: Math.min(...values),
    max: Math.max(...values),
    n: values.length,
    from: pts[0].date,
  };
}

// ---- Peers (same fiscal year for everyone) ------------------------------------------

/** Multiples on one fiscal year's figures (SEC frames inputs), the basis used for peers. */
export function yearMultiples(marketCap: number, i: RatioInputs): Record<MultipleKey, number | null> {
  const pos = (v: number | undefined) => (v !== undefined && v > 0 ? v : null);
  const ni = pos(i.netIncome);
  const rev = i.revenueAmbiguous ? null : pos(i.revenue);
  const eq = pos(i.equity);
  return {
    pe: ni ? marketCap / ni : null,
    ps: rev ? marketCap / rev : null,
    pb: eq ? marketCap / eq : null,
    fcfYield: i.ocf !== undefined && i.capex !== undefined && marketCap > 0 ? (i.ocf - i.capex) / marketCap : null,
  };
}

export const MIN_VALUATION_PEERS = 5;

export interface PeerComparison {
  value: number; // the company's multiple on the same basis
  percentile: number;
  median: number;
  n: number;
  sicPrefix: string;
}

/** Narrowest SIC group (3 digits, then 2) with enough priced peers. */
export function peerComparison(
  key: MultipleKey,
  value: number,
  sic: number,
  peers: { sic: number; values: Record<MultipleKey, number | null> }[],
): PeerComparison | null {
  const vals = (rows: typeof peers) => rows.map((p) => p.values[key]).filter((v): v is number => v !== null);
  for (const digits of [3, 2]) {
    const div = digits === 3 ? 10 : 100;
    const group = vals(peers.filter((p) => Math.floor(p.sic / div) === Math.floor(sic / div)));
    if (group.length >= MIN_VALUATION_PEERS) {
      return { value, percentile: percentileRank(group, value)!, median: median(group)!, n: group.length, sicPrefix: String(Math.floor(sic / div)) };
    }
  }
  return null;
}

// ---- Beta ---------------------------------------------------------------------------------

/** Month-end closes keyed by YYYY-MM. */
function monthEnds(candles: Candle[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of candles) if (c.close > 0) m.set(c.time.slice(0, 7), c.close);
  return m;
}

export const MIN_BETA_MONTHS = 24;

/**
 * Beta = cov(stock, market) ÷ var(market) on monthly returns over the common history
 * (up to 5 years). Needs at least 24 months.
 */
export function marketBeta(stock: Candle[], market: Candle[]): { value: number; months: number } | null {
  const s = monthEnds(stock);
  const m = monthEnds(market);
  const months = [...s.keys()].filter((k) => m.has(k)).sort();
  const rs: number[] = [];
  const rm: number[] = [];
  for (let i = 1; i < months.length; i++) {
    rs.push(s.get(months[i])! / s.get(months[i - 1])! - 1);
    rm.push(m.get(months[i])! / m.get(months[i - 1])! - 1);
  }
  if (rs.length < MIN_BETA_MONTHS) return null;
  const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
  const ms = mean(rs);
  const mm = mean(rm);
  let cov = 0;
  let varM = 0;
  for (let i = 0; i < rs.length; i++) {
    cov += (rs[i] - ms) * (rm[i] - mm);
    varM += (rm[i] - mm) ** 2;
  }
  if (!(varM > 0)) return null;
  return { value: cov / varM, months: rs.length };
}
