// Extras for the financial statements screen, as pure functions:
//  - a trailing-twelve-months (TTM) column built from the last four quarters,
//  - checks that the numbers add up (and match a second source when available),
//  - a percent-of-revenue projection of the three statements under editable assumptions.
import { DERIVED, LINES, type Cell, type LineKey, type Period, type StatementSet } from "./secFinancials";

export type Column = Partial<Record<LineKey, Cell>>;

const DAY = 86_400_000;
const quarterApart = (a: string, b: string) => {
  const d = (Date.parse(b) - Date.parse(a)) / DAY;
  return d >= 80 && d <= 100;
};
const ADDITIVE_FLOWS = new Set<LineKey>([
  ...LINES.filter((l) => l.kind === "flow" && l.additive).map((l) => l.key),
  ...DERIVED.map((d) => d.key),
]);
const INSTANTS = new Set<LineKey>(LINES.filter((l) => l.kind === "instant").map((l) => l.key));

/**
 * TTM column: flows are the sum of the last four consecutive quarters, balances are the last
 * quarter's, EPS is TTM net income ÷ the last quarter's diluted shares. Returned only when the
 * last quarter ends after the last fiscal year (otherwise TTM would just repeat that year).
 */
export function ttmColumn(q: StatementSet, lastFiscalEnd: string | null): { period: Period; cells: Column } | null {
  const n = q.periods.length;
  if (n < 4) return null;
  const idx = [n - 4, n - 3, n - 2, n - 1];
  if (!idx.slice(1).every((j, k) => quarterApart(q.periods[idx[k]].end, q.periods[j].end))) return null;
  const last = q.periods[n - 1];
  if (lastFiscalEnd && last.end <= lastFiscalEnd) return null;
  const cells: Column = {};
  for (const [key, list] of Object.entries(q.lines) as [LineKey, Cell[]][]) {
    if (ADDITIVE_FLOWS.has(key)) {
      const vals = idx.map((i) => list[i]?.value ?? null);
      cells[key] = vals.every((v) => v !== null)
        ? { value: vals.reduce((a, b) => a + b!, 0), derived: "ttm", ...(idx.some((i) => list[i]?.alt) ? { alt: list[idx.find((i) => list[i]?.alt)!].alt } : {}) }
        : { value: null };
    } else if (INSTANTS.has(key)) {
      cells[key] = list[n - 1] ?? { value: null };
    }
  }
  const shares = q.lines.dilutedShares?.[n - 1]?.value ?? null;
  const ni = cells.netIncome?.value ?? null;
  cells.dilutedShares = shares !== null ? { ...q.lines.dilutedShares![n - 1] } : { value: null };
  cells.epsDiluted = ni !== null && shares ? { value: ni / shares, derived: "ttm" } : { value: null };
  return { period: { end: last.end, label: "TTM", accn: last.accn, form: last.form, filed: last.filed }, cells };
}

// ---- Checks ---------------------------------------------------------------------------------

export type CheckIssue =
  | { kind: "gross"; expected: number; reported: number }
  | { kind: "balance"; assets: number; liabilitiesPlusEquity: number }
  | { kind: "source"; line: "revenue" | "netIncome"; sec: number; other: number };

export const CHECK_TOLERANCE = 0.01;
export const BALANCE_TOLERANCE = 0.05; // noncontrolling interests and temporary equity sit outside "equity"

const off = (a: number, b: number, tol: number) => Math.abs(a - b) > Math.max(Math.abs(b), 1) * tol;

/** Accounting identities within a column, and agreement with a second source when given. */
export function checkColumn(c: Column, other?: { revenue?: number; netIncome?: number }): { ok: boolean; issues: CheckIssue[]; checked: number } {
  const v = (k: LineKey) => c[k]?.value ?? null;
  const issues: CheckIssue[] = [];
  let checked = 0;
  const rev = v("revenue");
  const cost = v("costOfRevenue");
  const gp = v("grossProfit");
  if (rev !== null && cost !== null && gp !== null && !c.revenue?.alt) {
    checked++;
    if (off(gp, rev - cost, CHECK_TOLERANCE)) issues.push({ kind: "gross", expected: rev - cost, reported: gp });
  }
  const assets = v("totalAssets");
  const liab = v("totalLiabilities");
  const eq = v("equity");
  if (assets !== null && liab !== null && eq !== null) {
    checked++;
    if (off(liab + eq, assets, BALANCE_TOLERANCE)) issues.push({ kind: "balance", assets, liabilitiesPlusEquity: liab + eq });
  }
  for (const line of ["revenue", "netIncome"] as const) {
    const sec = v(line);
    const o = other?.[line];
    if (sec !== null && o !== undefined && o !== 0) {
      checked++;
      if (off(sec, o, CHECK_TOLERANCE)) issues.push({ kind: "source", line, sec, other: o });
    }
  }
  return { ok: issues.length === 0, issues, checked };
}

// ---- Projections ----------------------------------------------------------------------------

export interface ProjectionAssumptions {
  growth: number[]; // revenue growth per year
  grossMargin: number[] | null; // null when the company doesn't report gross profit
  opMargin: number[];
  interestPct: number[]; // interest expense ÷ revenue
  otherPct: number[]; // other non-operating income ÷ revenue (equity stakes, investment income…)
  taxRate: number[];
  daPct: number[];
  capexPct: number[];
  nwcPct: number[]; // change in working capital ÷ change in revenue
  payout: number[]; // dividends ÷ net income
  buybackPct: number[]; // buybacks ÷ free cash flow
  shareChange: number[]; // yearly change in diluted shares
}

export interface ProjectionBase {
  label: string; // last fiscal year, e.g. FY2026
  end: string;
  revenue: number;
  cash: number;
  totalLiabilities: number;
  equity: number;
  longTermDebt: number | null;
  currentDebt: number | null;
  dilutedShares: number;
}

export const PROJECTION_YEARS = 5;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Values of a line in the last `k` fiscal years (nulls skipped). */
function lastValues(set: StatementSet, key: LineKey, k: number): (number | null)[] {
  const list = set.lines[key] ?? [];
  return list.slice(-k).map((c) => c.value);
}

/**
 * Starting assumptions from the company's history: growth fades from its 5-year revenue CAGR
 * towards 2.5 %; margins and ratios are 3-year averages; payout and buybacks are last year's.
 */
export function projectionDefaults(annual: StatementSet, sharesFallback?: number | null): { base: ProjectionBase; assumptions: ProjectionAssumptions } | null {
  const n = annual.periods.length;
  if (n === 0) return null;
  const last = (k: LineKey) => annual.lines[k]?.[n - 1]?.value ?? null;
  const revenue = last("revenue");
  // Diluted weighted shares, or the cover-page count for filers that don't tag them.
  const shares = last("dilutedShares") ?? sharesFallback ?? null;
  if (!revenue || revenue <= 0 || !shares) return null;

  const revs = lastValues(annual, "revenue", 3);
  const ratio3 = (k: LineKey) => {
    const nums = lastValues(annual, k, 3);
    return avg(nums.flatMap((x, i) => (x !== null && revs[i] ? [x / revs[i]!] : [])));
  };
  const rev5 = annual.lines.revenue?.[n - 6]?.value ?? null;
  const cagr = rev5 && rev5 > 0 ? (revenue / rev5) ** (1 / 5) - 1 : null;
  const g0 = clamp(cagr ?? 0.03, -0.05, 0.25);
  const years = PROJECTION_YEARS;
  const growth = Array.from({ length: years }, (_, k) => r4(g0 + ((0.025 - g0) * k) / years));
  const flat = (x: number) => growth.map(() => r4(x));

  const gm = ratio3("grossProfit") ?? (() => {
    const cost = ratio3("costOfRevenue");
    return cost === null ? null : 1 - cost;
  })();
  // Companies without an operating-income line (banks, some conglomerates) are projected on
  // pretax income directly, with interest and other income folded in.
  let op = ratio3("operatingIncome");
  let interestPct = ratio3("interestExpense") ?? 0;
  let otherPct = 0;
  if (op === null) {
    op = ratio3("pretaxIncome") ?? 0.1;
    interestPct = 0;
  } else {
    // Other income = pretax − (operating income − interest), averaged over 3 years.
    const pres = lastValues(annual, "pretaxIncome", 3);
    const ops = lastValues(annual, "operatingIncome", 3);
    const ints = lastValues(annual, "interestExpense", 3);
    otherPct = avg(pres.flatMap((p, i) => (p !== null && ops[i] !== null && revs[i] ? [(p - (ops[i]! - (ints[i] ?? 0))) / revs[i]!] : []))) ?? 0;
  }
  const pre = last("pretaxIncome");
  const tax = last("incomeTax");
  const taxRate = pre && pre > 0 && tax !== null ? clamp(tax / pre, 0, 0.35) : 0.21;
  const ni = last("netIncome");
  const fcf = last("freeCashFlow");
  const payout = ni && ni > 0 ? clamp((last("dividendsPaid") ?? 0) / ni, 0, 1) : 0;
  const buyback = fcf && fcf > 0 ? clamp((last("buybacks") ?? 0) / fcf, 0, 1.5) : 0;
  const shares3 = annual.lines.dilutedShares?.[n - 4]?.value ?? null;
  const shareChange = shares3 && shares3 > 0 ? clamp((shares / shares3) ** (1 / 3) - 1, -0.1, 0.1) : 0;

  return {
    base: {
      label: annual.periods[n - 1].label,
      end: annual.periods[n - 1].end,
      revenue,
      cash: last("cash") ?? 0,
      totalLiabilities: last("totalLiabilities") ?? 0,
      equity: last("equity") ?? 0,
      longTermDebt: last("longTermDebt"),
      currentDebt: last("currentDebt"),
      dilutedShares: shares,
    },
    assumptions: {
      growth,
      grossMargin: gm === null ? null : flat(gm),
      opMargin: flat(op),
      interestPct: flat(interestPct),
      otherPct: flat(otherPct),
      taxRate: flat(taxRate),
      daPct: flat(ratio3("depreciation") ?? 0),
      capexPct: flat(ratio3("capex") ?? 0),
      nwcPct: flat(0),
      payout: flat(payout),
      buybackPct: flat(buyback),
      shareChange: flat(shareChange),
    },
  };
}

/**
 * Projected statements, one column per year. Liabilities and debt stay at the last reported
 * level; equity rolls forward with earnings less dividends and buybacks; cash with free cash
 * flow less payouts; assets = liabilities + equity, so the balance sheet always balances.
 */
export function projectStatements(base: ProjectionBase, a: ProjectionAssumptions): { periods: Period[]; lines: Partial<Record<LineKey, Cell[]>> } {
  const years = a.growth.length;
  const lines: Partial<Record<LineKey, Cell[]>> = {};
  const put = (k: LineKey, v: number | null) => (lines[k] ??= []).push({ value: v, derived: "projection" });
  const fy = Number(base.label.replace(/\D/g, "")) || new Date(base.end).getUTCFullYear();
  const periods: Period[] = [];
  let rev = base.revenue;
  let cash = base.cash;
  let equity = base.equity;
  let shares = base.dilutedShares;
  for (let k = 0; k < years; k++) {
    const prev = rev;
    rev = prev * (1 + a.growth[k]);
    const gp = a.grossMargin ? rev * a.grossMargin[k] : null;
    const op = rev * a.opMargin[k];
    const interest = rev * a.interestPct[k];
    const pretax = op - interest + rev * a.otherPct[k];
    const tax = pretax * a.taxRate[k];
    const ni = pretax - tax;
    shares *= 1 + a.shareChange[k];
    const da = rev * a.daPct[k];
    const ocf = ni + da - (rev - prev) * a.nwcPct[k];
    const capex = rev * a.capexPct[k];
    const fcf = ocf - capex;
    const dividends = Math.max(0, ni * a.payout[k]);
    const buybacks = Math.max(0, fcf * a.buybackPct[k]);
    cash += fcf - dividends - buybacks;
    equity += ni - dividends - buybacks;

    put("revenue", rev);
    put("costOfRevenue", gp === null ? null : rev - gp);
    put("grossProfit", gp);
    put("operatingIncome", op);
    put("interestExpense", interest);
    put("pretaxIncome", pretax);
    put("incomeTax", tax);
    put("netIncome", ni);
    put("dilutedShares", shares);
    put("epsDiluted", ni / shares);
    put("cash", cash);
    put("totalLiabilities", base.totalLiabilities);
    put("currentDebt", base.currentDebt);
    put("longTermDebt", base.longTermDebt);
    put("equity", equity);
    put("totalAssets", base.totalLiabilities + equity);
    put("operatingCashFlow", ocf);
    put("depreciation", da);
    put("capex", capex);
    put("freeCashFlow", fcf);
    put("dividendsPaid", dividends);
    put("buybacks", buybacks);
    periods.push({ end: `${fy + k + 1}`, label: `FY${fy + k + 1}E` });
  }
  return { periods, lines };
}
