// Long-term business quality from the company's own SEC annual statements: the checks a
// Buffett-style investor runs before thinking about price. Thresholds follow Mary Buffett and
// David Clark, "Warren Buffett and the Interpretation of Financial Statements" (2008), and are
// shown next to every result. Descriptive, never a recommendation. Pure functions: the server
// route loads the statements and the same code runs in tests.
import { TAX_RATE, type BusinessType } from "./ratios";
import type { LineKey, SharesHistory, StatementSet } from "./secFinancials";

export const QUALITY_YEARS = 10;
const MIN_YEARS = 5;
const DAY = 86_400_000;

export const THRESHOLDS = {
  roic: 0.15, // after-tax return on capital, in at least 80 % of the years
  roe: 0.12, // banks and insurers
  roa: 0.01, // banks
  persistence: 0.8, // share of years that must clear a return threshold
  grossMargin: 0.4, // median gross margin
  grossMarginDrop: 0.05, // latest may sit at most 5 points under the median
  consistency: 0.7, // share of years in which EPS (or book value per share) grew
  cashConversion: 0.8, // free cash flow ÷ net income over the years
  capex: 0.5, // capital expenditure ÷ net income over the years
  debtYears: 4, // long-term debt ÷ average net income of the last 3 years
  interest: 0.15, // interest expense ÷ operating income
  buybacks: -0.01, // diluted shares over the period (at least 1 % fewer)
} as const;

export type CheckKey =
  | "roic" | "roe" | "roa" | "grossMargin" | "epsGrowth" | "bookValue"
  | "cashConversion" | "capex" | "debt" | "interest" | "buybacks";
export type CheckStatus = "pass" | "fail" | "na";

export interface QualityCheck {
  key: CheckKey;
  status: CheckStatus;
  facts: Record<string, number>; // the numbers the sentence quotes
  from?: string; // first fiscal year used
  to?: string; // last fiscal year used
}

// REITs are left out: depreciation makes their net income understate the cash they earn, and
// their model (pay out almost everything, fund growth with new shares and debt) fails these
// checks by design.
export const CHECKS: Record<BusinessType, CheckKey[]> = {
  general: ["roic", "grossMargin", "epsGrowth", "cashConversion", "capex", "debt", "interest", "buybacks"],
  bank: ["roe", "roa", "epsGrowth", "bookValue", "buybacks"],
  insurance: ["roe", "epsGrowth", "bookValue", "buybacks"],
  reit: [],
};

export interface YearRow {
  label: string;
  end: string;
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  eps: number | null; // diluted, restated to today's share basis
  shares: number | null; // diluted weighted average, restated to today's share basis
  fcf: number | null;
  capex: number | null;
  equity: number | null;
  assets: number | null;
  longTermDebt: number | null;
  interestExpense: number | null;
  dividendsPaid: number | null;
}

/**
 * Split factor per fiscal year (multiply shares, divide EPS). Older figures come from the
 * filings of their time, so a split shows up as a jump in diluted shares between two years at
 * or before the split. Only splits confirmed by the cover-page share counts are applied, and
 * only where the jump matches the split ratio (within 20 %: a year of buybacks or issuance).
 */
export function splitFactors(set: StatementSet, splits: SharesHistory["splits"]): number[] {
  const n = set.periods.length;
  const f = new Array<number>(n).fill(1);
  const shares = set.lines.dilutedShares ?? [];
  for (const s of splits) {
    if (!(s.ratio > 0) || s.ratio === 1) continue;
    const latest = Date.parse(s.before) + 366 * DAY; // the fiscal year that contains the split
    let boundary = -1;
    for (let i = 1; i < n; i++) {
      const a = shares[i - 1]?.value;
      const b = shares[i]?.value;
      if (!a || !b || Date.parse(set.periods[i].end) > latest) continue;
      if (Math.abs(b / a / s.ratio - 1) <= 0.2) boundary = i;
    }
    for (let i = 0; i < boundary; i++) f[i] *= s.ratio;
  }
  return f;
}

export function yearRows(set: StatementSet, splits: SharesHistory["splits"]): YearRow[] {
  const f = splitFactors(set, splits);
  const v = (k: LineKey, i: number) => {
    const x = set.lines[k]?.[i]?.value;
    return typeof x === "number" && Number.isFinite(x) ? x : null;
  };
  return set.periods.map((p, i) => {
    const revenue = v("revenue", i);
    const cost = v("costOfRevenue", i);
    const eps = v("epsDiluted", i);
    const shares = v("dilutedShares", i);
    return {
      label: p.label,
      end: p.end,
      revenue,
      grossProfit: v("grossProfit", i) ?? (revenue !== null && cost !== null ? revenue - cost : null),
      operatingIncome: v("operatingIncome", i),
      netIncome: v("netIncome", i),
      eps: eps === null ? null : eps / f[i],
      shares: shares === null ? null : shares * f[i],
      fcf: v("freeCashFlow", i),
      capex: v("capex", i),
      equity: v("equity", i),
      assets: v("totalAssets", i),
      longTermDebt: v("longTermDebt", i),
      interestExpense: v("interestExpense", i),
      dividendsPaid: v("dividendsPaid", i),
    };
  });
}

const ratio = (a: number | null, b: number | null) => (a !== null && b !== null && b > 0 ? a / b : null);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const yearsBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (365.25 * DAY);

/** Compound annual growth; null unless both ends are positive and at least a year apart. */
export function cagr(first: number | null, last: number | null, years: number): number | null {
  if (first === null || last === null || !(first > 0) || !(last > 0) || years < 0.9) return null;
  return (last / first) ** (1 / years) - 1;
}

// Per-year series used by the checks and the trend charts.
export const roicOf = (r: YearRow) =>
  r.operatingIncome !== null && r.equity !== null && r.longTermDebt !== null
    ? ratio(r.operatingIncome * (1 - TAX_RATE), r.equity + r.longTermDebt)
    : null;
export const roeOf = (r: YearRow) => ratio(r.netIncome, r.equity);
export const roaOf = (r: YearRow) => ratio(r.netIncome, r.assets);
export const grossMarginOf = (r: YearRow) => ratio(r.grossProfit, r.revenue);
export const operatingMarginOf = (r: YearRow) => ratio(r.operatingIncome, r.revenue);
export const netMarginOf = (r: YearRow) => ratio(r.netIncome, r.revenue);
export const fcfMarginOf = (r: YearRow) => ratio(r.fcf, r.revenue);
export const bookValuePerShareOf = (r: YearRow) => ratio(r.equity, r.shares);

/** A return that must clear a bar in most years. */
function persistent(key: CheckKey, rows: YearRow[], of: (r: YearRow) => number | null, bar: number): QualityCheck {
  const pts = rows.map((r) => ({ r, x: of(r) })).filter((p): p is { r: YearRow; x: number } => p.x !== null);
  if (pts.length < MIN_YEARS) return { key, status: "na", facts: { n: pts.length } };
  const xs = pts.map((p) => p.x);
  const count = xs.filter((x) => x >= bar).length;
  return {
    key,
    status: count >= Math.ceil(THRESHOLDS.persistence * xs.length) ? "pass" : "fail",
    facts: { count, n: xs.length, median: median(xs), latest: xs[xs.length - 1], bar },
    from: pts[0].r.label,
    to: pts[pts.length - 1].r.label,
  };
}

/** A per-share figure that should rise in most years and over the whole period. */
function rising(key: CheckKey, rows: YearRow[], of: (r: YearRow) => number | null): QualityCheck {
  const pts = rows.map((r) => ({ r, x: of(r) })).filter((p): p is { r: YearRow; x: number } => p.x !== null);
  if (pts.length < MIN_YEARS) return { key, status: "na", facts: { n: pts.length } };
  let ups = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i].x > pts[i - 1].x) ups++;
  const pairs = pts.length - 1;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const g = cagr(first.x, last.x, yearsBetween(first.r.end, last.r.end));
  const facts: Record<string, number> = { ups, pairs, first: first.x, last: last.x };
  if (g !== null) facts.cagr = g;
  return {
    key,
    status: ups >= Math.ceil(THRESHOLDS.consistency * pairs) && g !== null && g > 0 ? "pass" : "fail",
    facts,
    from: first.r.label,
    to: last.r.label,
  };
}

/** Sum of a ÷ sum of b over the years that have both. */
function overYears(key: CheckKey, rows: YearRow[], a: (r: YearRow) => number | null, pass: (x: number) => boolean): QualityCheck {
  const pts = rows.filter((r) => a(r) !== null && r.netIncome !== null);
  if (pts.length < MIN_YEARS) return { key, status: "na", facts: { n: pts.length } };
  const top = pts.reduce((s, r) => s + a(r)!, 0);
  const ni = pts.reduce((s, r) => s + r.netIncome!, 0);
  const base = { n: pts.length, total: top, netIncome: ni };
  if (!(ni > 0)) return { key, status: "fail", facts: { ...base, noProfit: 1 }, from: pts[0].label, to: pts[pts.length - 1].label };
  const x = top / ni;
  return { key, status: pass(x) ? "pass" : "fail", facts: { ...base, ratio: x }, from: pts[0].label, to: pts[pts.length - 1].label };
}

function debtCheck(rows: YearRow[]): QualityCheck {
  const last = rows[rows.length - 1];
  if (!last || last.longTermDebt === null) return { key: "debt", status: "na", facts: {} };
  const recent = rows.slice(-3).map((r) => r.netIncome).filter((x): x is number => x !== null);
  if (recent.length === 0) return { key: "debt", status: "na", facts: {} };
  const avg = recent.reduce((s, x) => s + x, 0) / recent.length;
  const debt = last.longTermDebt;
  if (debt <= 0) return { key: "debt", status: "pass", facts: { debt: 0, years: 0, income: avg }, to: last.label };
  if (!(avg > 0)) return { key: "debt", status: "fail", facts: { debt, income: avg, noProfit: 1 }, to: last.label };
  const years = debt / avg;
  return { key: "debt", status: years <= THRESHOLDS.debtYears ? "pass" : "fail", facts: { debt, income: avg, years }, to: last.label };
}

function interestCheck(rows: YearRow[]): QualityCheck {
  // Many filers stop tagging interest separately; the latest of the last 4 years will do.
  const recent = rows.slice(-4).reverse().find((r) => r.interestExpense !== null && r.operatingIncome !== null);
  if (!recent) return { key: "interest", status: "na", facts: {} };
  const interest = Math.abs(recent.interestExpense!);
  if (!(recent.operatingIncome! > 0)) {
    return { key: "interest", status: interest > 0 ? "fail" : "pass", facts: { interest, noProfit: 1 }, to: recent.label };
  }
  const x = interest / recent.operatingIncome!;
  return { key: "interest", status: x <= THRESHOLDS.interest ? "pass" : "fail", facts: { ratio: x, interest }, to: recent.label };
}

function buybacksCheck(rows: YearRow[]): QualityCheck {
  const pts = rows.filter((r) => r.shares !== null);
  if (pts.length < MIN_YEARS) return { key: "buybacks", status: "na", facts: { n: pts.length } };
  const first = pts[0];
  const last = pts[pts.length - 1];
  const change = last.shares! / first.shares! - 1;
  const facts: Record<string, number> = { change, first: first.shares!, last: last.shares! };
  const g = cagr(first.shares, last.shares, yearsBetween(first.end, last.end));
  if (g !== null) facts.cagr = g;
  return { key: "buybacks", status: change <= THRESHOLDS.buybacks ? "pass" : "fail", facts, from: first.label, to: last.label };
}

export function runCheck(key: CheckKey, rows: YearRow[]): QualityCheck {
  switch (key) {
    case "roic":
      return persistent("roic", rows, roicOf, THRESHOLDS.roic);
    case "roe":
      return persistent("roe", rows, roeOf, THRESHOLDS.roe);
    case "roa":
      return persistent("roa", rows, roaOf, THRESHOLDS.roa);
    case "grossMargin": {
      const pts = rows.map((r) => ({ r, x: grossMarginOf(r) })).filter((p): p is { r: YearRow; x: number } => p.x !== null);
      if (pts.length < MIN_YEARS) return { key, status: "na", facts: { n: pts.length } };
      const xs = pts.map((p) => p.x);
      const med = median(xs);
      const latest = xs[xs.length - 1];
      const ok = med >= THRESHOLDS.grossMargin && latest >= med - THRESHOLDS.grossMarginDrop;
      return {
        key,
        status: ok ? "pass" : "fail",
        facts: { median: med, latest, min: Math.min(...xs), max: Math.max(...xs), n: xs.length },
        from: pts[0].r.label,
        to: pts[pts.length - 1].r.label,
      };
    }
    case "epsGrowth":
      return rising("epsGrowth", rows, (r) => r.eps);
    case "bookValue":
      return rising("bookValue", rows, bookValuePerShareOf);
    case "cashConversion":
      return overYears("cashConversion", rows, (r) => r.fcf, (x) => x >= THRESHOLDS.cashConversion);
    case "capex":
      return overYears("capex", rows, (r) => (r.capex === null ? null : Math.abs(r.capex)), (x) => x <= THRESHOLDS.capex);
    case "debt":
      return debtCheck(rows);
    case "interest":
      return interestCheck(rows);
    case "buybacks":
      return buybacksCheck(rows);
  }
}

export type QualityLevel = "high" | "mixed" | "low" | "na";

export function summarizeChecks(checks: QualityCheck[]): { passed: number; failed: number; na: number; level: QualityLevel } {
  const passed = checks.filter((c) => c.status === "pass").length;
  const failed = checks.filter((c) => c.status === "fail").length;
  const na = checks.length - passed - failed;
  const judged = passed + failed;
  const share = judged ? passed / judged : 0;
  const level: QualityLevel = judged < 4 ? "na" : share >= 0.75 ? "high" : share >= 0.5 ? "mixed" : "low";
  return { passed, failed, na, level };
}

export type GrowthKey = "revenue" | "eps" | "fcf" | "bookValue";
export const GROWTH_SPANS = [3, 5, 10] as const;

/** CAGR over the last 3, 5 and 10 fiscal years, ending at the latest one. */
export function growthTable(rows: YearRow[], type: BusinessType): { key: GrowthKey; cagr: Record<(typeof GROWTH_SPANS)[number], number | null> }[] {
  const keys: GrowthKey[] = type === "bank" || type === "insurance" ? ["eps", "bookValue"] : ["revenue", "eps", "fcf"];
  const of: Record<GrowthKey, (r: YearRow) => number | null> = {
    revenue: (r) => r.revenue,
    eps: (r) => r.eps,
    fcf: (r) => r.fcf,
    bookValue: bookValuePerShareOf,
  };
  const last = rows.length - 1;
  return keys.map((key) => {
    const out = {} as Record<(typeof GROWTH_SPANS)[number], number | null>;
    for (const span of GROWTH_SPANS) {
      const i = last - span;
      out[span] = i >= 0 ? cagr(of[key](rows[i]), of[key](rows[last]), yearsBetween(rows[i].end, rows[last].end)) : null;
    }
    return { key, cagr: out };
  });
}

/** Checks for the last 10 fiscal years. */
export function assessQuality(annual: StatementSet, splits: SharesHistory["splits"], type: BusinessType) {
  const all = yearRows(annual, splits);
  const rows = all.slice(-QUALITY_YEARS);
  const checks = CHECKS[type].map((k) => runCheck(k, rows));
  return { rows, checks, summary: summarizeChecks(checks), growth: growthTable(all, type) };
}
