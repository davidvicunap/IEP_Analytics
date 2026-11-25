// Extras for the financial statements screen, as pure functions:
//  - a trailing-twelve-months (TTM) column built from the last four quarters,
//  - checks that the numbers add up (and match a second source when available),
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
