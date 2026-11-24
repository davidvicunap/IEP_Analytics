// What the Financials tab shows, computed from the SEC statements: the rows of each statement,
// one unit per table (stated once, like a printed annual report), the three ways to read a row
// (values, share of revenue or assets, change on the year before), five-year growth, and the
// findings the summary states in words. Pure and tested; the views live in components/financials.
import type { Cell, LineKey, Period, StatementKey, StatementSet } from "./secFinancials";
import type { Column } from "./statements";

export interface Row {
  key: LineKey;
  /** A subtotal: set in bold with a rule above. */
  total?: boolean;
  kind?: "perShare" | "shares";
  /** A payment, shown in parentheses as in the 10-K cash flow statement. */
  outflow?: boolean;
}

export const STATEMENT_ROWS: Record<StatementKey, Row[]> = {
  income: [
    { key: "revenue", total: true },
    { key: "costOfRevenue" },
    { key: "grossProfit", total: true },
    { key: "researchDevelopment" },
    { key: "sga" },
    { key: "operatingIncome", total: true },
    { key: "interestExpense" },
    { key: "pretaxIncome" },
    { key: "incomeTax" },
    { key: "netIncome", total: true },
    { key: "epsDiluted", kind: "perShare" },
    { key: "dilutedShares", kind: "shares" },
  ],
  balance: [
    { key: "cash" },
    { key: "shortTermInvestments" },
    { key: "receivables" },
    { key: "inventory" },
    { key: "currentAssets", total: true },
    { key: "totalAssets", total: true },
    { key: "currentLiabilities" },
    { key: "currentDebt" },
    { key: "longTermDebt" },
    { key: "totalLiabilities", total: true },
    { key: "equity", total: true },
  ],
  cashflow: [
    { key: "operatingCashFlow", total: true },
    { key: "depreciation" },
    { key: "stockComp" },
    { key: "capex", outflow: true },
    { key: "freeCashFlow", total: true },
    { key: "dividendsPaid", outflow: true },
    { key: "buybacks", outflow: true },
  ],
};

export type Mode = "values" | "common" | "growth";

/** One unit for a whole table, chosen so its largest figure stays short. */
export interface Scale {
  div: number;
  unit: "B" | "M" | "K";
  digits: number;
}
export function pickScale(maxAbs: number): Scale {
  if (maxAbs >= 1e10) return { div: 1e9, unit: "B", digits: 1 };
  if (maxAbs >= 1e8) return { div: 1e6, unit: "M", digits: 0 };
  if (maxAbs >= 1e6) return { div: 1e6, unit: "M", digits: 1 };
  return { div: 1e3, unit: "K", digits: 0 };
}

/** Financial-print style: thousands separated, negatives in parentheses. */
export function fmtScaled(v: number | null, scale: Scale, lang: "es" | "en"): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const s = new Intl.NumberFormat(lang === "es" ? "es-US" : "en-US", { minimumFractionDigits: scale.digits, maximumFractionDigits: scale.digits }).format(Math.abs(v) / scale.div);
  return v < 0 ? `(${s})` : s;
}

export function fmtPerShare(v: number | null, lang: "es" | "en"): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const s = new Intl.NumberFormat(lang === "es" ? "es-US" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(v));
  return v < 0 ? `(${s})` : s;
}

export function fmtPct(v: number | null, lang: "es" | "en", digits = 1): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const s = new Intl.NumberFormat(lang === "es" ? "es-US" : "en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(v) * 100);
  return v < 0 ? `(${s}%)` : `${s}%`;
}

/** Compound annual growth between two positive values `years` apart; null when it isn't defined. */
export function cagr(first: number | null | undefined, last: number | null | undefined, years: number): number | null {
  if (first == null || last == null || years <= 0 || first <= 0 || last <= 0) return null;
  return (last / first) ** (1 / years) - 1;
}

/** Change on the previous value; null when either is missing or the base is zero. */
export function change(prev: number | null | undefined, cur: number | null | undefined): number | null {
  if (prev == null || cur == null || prev === 0) return null;
  return (cur - prev) / Math.abs(prev);
}

/** The base a row is shared against: revenue for flows, total assets for the balance sheet. */
export function commonBase(statement: StatementKey): LineKey {
  return statement === "balance" ? "totalAssets" : "revenue";
}

/**
 * What a cell shows: the value (payments negative), its share of the period's revenue or
 * assets, or its change on `prev` (the year before, or the same quarter a year earlier).
 * Per-share and share-count rows have no common-size reading.
 */
export function shownValue(row: Row, cur: Column, prev: Column | null, mode: Mode, statement: StatementKey): number | null {
  const v = cur[row.key]?.value ?? null;
  if (mode === "growth") return prev ? change(prev[row.key]?.value, v) : null;
  const signed = v !== null && row.outflow ? -v : v;
  if (mode === "values") return signed;
  if (row.kind) return null;
  const base = cur[commonBase(statement)]?.value;
  return signed !== null && base ? signed / base : null;
}

/** A line the company stopped reporting: values earlier, none in the latest `recent` periods. */
export function notReportedSince(cells: Cell[], periods: Period[], recent = 2): string | null {
  const last = cells.map((c) => c.value).findLastIndex((v) => v !== null);
  if (last === -1 || last >= cells.length - recent) return null;
  return periods[last + 1]?.label ?? null;
}

const val = (set: StatementSet, key: LineKey, i: number) => set.lines[key]?.[i]?.value ?? null;
const sum = (xs: (number | null)[]) => (xs.some((x) => x === null) ? null : xs.reduce<number>((a, b) => a + (b as number), 0));

/** Findings stated in words on the summary: each with the figures and fiscal years it rests on. */
export type Finding =
  | { kind: "growth"; cagr: number; from: number; to: number; fromLabel: string; toLabel: string; years: number }
  | { kind: "margin"; from: number; to: number; fromLabel: string; toLabel: string }
  | { kind: "cashConversion"; ratio: number; years: number }
  | { kind: "shares"; change: number; years: number }
  | { kind: "payout"; share: number; years: number; returned: number }
  | { kind: "netCash"; amount: number; label: string }
  | { kind: "netDebt"; amount: number; fcfYears: number | null; label: string }
  | { kind: "stockComp"; ofRevenue: number; ofFcf: number | null; label: string }
  | { kind: "rnd"; ofRevenue: number; label: string };

/** Up to five fiscal years back (fewer when the history is shorter). */
export function findings(annual: StatementSet, span = 5): Finding[] {
  const n = annual.periods.length;
  if (n < 2) return [];
  const last = n - 1;
  const first = Math.max(0, last - span);
  const years = last - first;
  const label = (i: number) => annual.periods[i].label;
  const out: Finding[] = [];

  const g = cagr(val(annual, "revenue", first), val(annual, "revenue", last), years);
  if (g !== null) out.push({ kind: "growth", cagr: g, from: val(annual, "revenue", first)!, to: val(annual, "revenue", last)!, fromLabel: label(first), toLabel: label(last), years });

  const margin = (i: number) => {
    const r = val(annual, "revenue", i);
    const o = val(annual, "operatingIncome", i);
    return r && o !== null ? o / r : null;
  };
  const m0 = margin(first);
  const m1 = margin(last);
  if (m0 !== null && m1 !== null) out.push({ kind: "margin", from: m0, to: m1, fromLabel: label(first), toLabel: label(last) });

  // Over the same window (not the first year itself: flows of `years` full years).
  const window = (key: LineKey) => sum(Array.from({ length: years }, (_, k) => val(annual, key, last - k)));
  const fcf = window("freeCashFlow");
  const ni = window("netIncome");
  if (fcf !== null && ni !== null && ni > 0) out.push({ kind: "cashConversion", ratio: fcf / ni, years });

  const sh = change(val(annual, "dilutedShares", first), val(annual, "dilutedShares", last));
  if (sh !== null) out.push({ kind: "shares", change: sh, years });

  const div = window("dividendsPaid") ?? 0;
  const bb = window("buybacks") ?? 0;
  if (fcf !== null && fcf > 0 && div + bb > 0) out.push({ kind: "payout", share: (div + bb) / fcf, years, returned: div + bb });

  // A part the company reported until recently and not now (a tagging change, usually) would
  // make the figure wrong, not just smaller: say nothing instead.
  const dropped = (key: LineKey) => val(annual, key, last) === null && [1, 2, 3].some((k) => last - k >= 0 && val(annual, key, last - k) !== null);
  const debt = (val(annual, "currentDebt", last) ?? 0) + (val(annual, "longTermDebt", last) ?? 0);
  const cash = val(annual, "cash", last);
  const parts: LineKey[] = ["shortTermInvestments", "currentDebt", "longTermDebt"];
  if (cash !== null && !parts.some(dropped)) {
    const liquid = cash + (val(annual, "shortTermInvestments", last) ?? 0);
    const net = debt - liquid;
    const lastFcf = val(annual, "freeCashFlow", last);
    if (net <= 0) out.push({ kind: "netCash", amount: -net, label: label(last) });
    else out.push({ kind: "netDebt", amount: net, fcfYears: lastFcf && lastFcf > 0 ? net / lastFcf : null, label: label(last) });
  }

  const rev = val(annual, "revenue", last);
  const sbc = val(annual, "stockComp", last);
  const lastFcf = val(annual, "freeCashFlow", last);
  if (rev && sbc !== null && sbc > 0) out.push({ kind: "stockComp", ofRevenue: sbc / rev, ofFcf: lastFcf && lastFcf > 0 ? sbc / lastFcf : null, label: label(last) });
  const rnd = val(annual, "researchDevelopment", last);
  if (rev && rnd !== null && rnd > 0) out.push({ kind: "rnd", ofRevenue: rnd / rev, label: label(last) });
  return out;
}

/** The six figures the summary leads with: a series per fiscal year, oldest first. */
export const KEY_METRICS = ["revenue", "operatingMargin", "netIncome", "freeCashFlow", "epsDiluted", "dilutedShares"] as const;
export type KeyMetric = (typeof KEY_METRICS)[number];

export function metricSeries(annual: StatementSet, metric: KeyMetric): (number | null)[] {
  return annual.periods.map((_, i) => {
    if (metric === "operatingMargin") {
      const r = val(annual, "revenue", i);
      const o = val(annual, "operatingIncome", i);
      return r && o !== null ? o / r : null;
    }
    return val(annual, metric, i);
  });
}
