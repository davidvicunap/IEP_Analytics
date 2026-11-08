// Growth the analysts' consensus implies. Pure: runs on the server and in the browser.
import type { AnalystEstimate } from "./fmp";

export interface ExpectedGrowth {
  /** Per fiscal year ahead: growth against the year before (revenue vs the SEC actual for the first). */
  years: { date: string; revenue: number | null; eps: number | null; revenueGrowth: number | null; epsGrowth: number | null; analysts: number | null }[];
  revenueCagr: { value: number; years: number } | null;
  epsCagr: { value: number; years: number } | null;
}

const DAY = 86_400_000;
const MAX_AHEAD = 3; // fiscal years ahead used for the headline growth
const growth = (a: number | null | undefined, b: number | null | undefined) =>
  a !== null && a !== undefined && b !== null && b !== undefined && a > 0 && b > 0 ? b / a - 1 : null;

/**
 * Growth the consensus implies. Revenue starts from the last fiscal year reported to the SEC
 * (same definition). EPS starts from the analysts' own figure for that year, because the EPS
 * they forecast is usually "adjusted" and doesn't match GAAP EPS.
 */
export function expectedGrowth(estimates: AnalystEstimate[], last: { end: string; revenue: number | null } | null): ExpectedGrowth {
  const lastEnd = last ? Date.parse(last.end) : Date.now() - 180 * DAY;
  const near = (d: string) => Math.abs(Date.parse(d) - lastEnd) <= 45 * DAY;
  const base = estimates.find((e) => near(e.date));
  const ahead = estimates.filter((e) => Date.parse(e.date) > lastEnd + 45 * DAY);
  let prevRev = last?.revenue ?? null;
  let prevEps = base?.eps?.avg ?? null;
  const years = ahead.map((e) => {
    const row = {
      date: e.date,
      revenue: e.revenue?.avg ?? null,
      eps: e.eps?.avg ?? null,
      revenueGrowth: growth(prevRev, e.revenue?.avg),
      epsGrowth: growth(prevEps, e.eps?.avg),
      analysts: e.analystsEps ?? e.analystsRevenue ?? null,
    };
    prevRev = e.revenue?.avg ?? null;
    prevEps = e.eps?.avg ?? null;
    return row;
  });
  const span = years.slice(0, MAX_AHEAD);
  const cagrTo = (from: number | null, pick: (y: (typeof years)[number]) => number | null) => {
    for (let i = span.length - 1; i >= 0; i--) {
      const to = pick(span[i]);
      if (from !== null && to !== null && from > 0 && to > 0) return { value: (to / from) ** (1 / (i + 1)) - 1, years: i + 1 };
    }
    return null;
  };
  return {
    years,
    revenueCagr: cagrTo(last?.revenue ?? null, (y) => y.revenue),
    epsCagr: cagrTo(base?.eps?.avg ?? null, (y) => y.eps),
  };
}
