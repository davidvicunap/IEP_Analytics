// The latest quarter at a glance: each key figure against the same quarter a year earlier
// (the fair comparison for seasonal businesses) and against the quarter before. Built on the
// same split-adjusted quarterly series as the chart generator. Pure.
import { fundamentalSeries } from "./chartMetrics";
import type { SharesHistory, StatementSet } from "./secFinancials";

export const QUARTER_METRICS = ["revenue", "grossMargin", "operatingMargin", "netIncome", "eps", "freeCashFlow"] as const;
export type QuarterMetric = (typeof QUARTER_METRICS)[number];

/** Margins change in percentage points; everything else in percent. */
export const IS_MARGIN = new Set<QuarterMetric>(["grossMargin", "operatingMargin"]);

export interface QuarterRow {
  key: QuarterMetric;
  now: number | null;
  yearAgo: number | null;
  prior: number | null;
  /** Growth (0.08 = +8 %) for amounts, or the change in points (0.012 = +1.2 pts) for margins. */
  vsYearAgo: number | null;
  vsPrior: number | null;
}

export interface QuarterReview {
  quarter: string; // calendar quarter, "2026-Q3"
  label: string; // the company's own label, "Q4 FY2026"
  end: string;
  yearAgoLabel: string | null;
  priorLabel: string | null;
  filing: { accn: string; form: string | null; filed: string | null } | null; // the report it comes from
  rows: QuarterRow[];
}

function change(key: QuarterMetric, now: number | null, base: number | null): number | null {
  if (now === null || base === null) return null;
  if (IS_MARGIN.has(key)) return now - base;
  // A percentage only means something between two positive figures: from or into a loss it's shown as "—".
  return base > 0 && now >= 0 ? now / base - 1 : null;
}

function shiftQuarter(key: string, by: number): string {
  const [y, q] = key.split("-Q").map(Number);
  const i = y * 4 + (q - 1) + by;
  return `${Math.floor(i / 4)}-Q${(i % 4) + 1}`;
}

export function quarterReview(quarterly: StatementSet, splits: SharesHistory["splits"]): QuarterReview | null {
  const s = fundamentalSeries(quarterly, splits, "quarterly");
  const last = s.keys.length - 1;
  if (last < 0) return null;
  const key = s.keys[last];
  const at = (k: string) => {
    const i = s.keys.indexOf(k);
    return i < 0 ? null : i;
  };
  const iYear = at(shiftQuarter(key, -4));
  const iPrior = at(shiftQuarter(key, -1));
  const value = (m: QuarterMetric, i: number | null) => (i === null ? null : (s.values[m]?.[i] ?? null));
  const rows = QUARTER_METRICS.map((m): QuarterRow => {
    const now = value(m, last);
    const yearAgo = value(m, iYear);
    const prior = value(m, iPrior);
    return { key: m, now, yearAgo, prior, vsYearAgo: change(m, now, yearAgo), vsPrior: change(m, now, prior) };
  });
  if (rows.every((r) => r.now === null)) return null;
  const period = (i: number | null) => (i === null ? undefined : quarterly.periods.find((p) => p.end === s.ends[i]));
  const p = period(last);
  return {
    quarter: key,
    label: p?.label ?? key,
    end: s.ends[last],
    yearAgoLabel: period(iYear)?.label ?? null,
    priorLabel: period(iPrior)?.label ?? null,
    filing: p?.accn ? { accn: p.accn, form: p.form ?? null, filed: p.filed ?? null } : null,
    rows,
  };
}

/** The earnings release (8-K item 2.02) filed for a quarter: the first one within 75 days after it ended. */
export function earningsRelease<F extends { form: string; filed: string; items: string[] }>(filings: F[], quarterEnd: string): F | null {
  const start = Date.parse(quarterEnd);
  const stop = start + 75 * 86_400_000;
  const hits = filings.filter((f) => /^8-K/.test(f.form) && f.items.includes("2.02") && Date.parse(f.filed) > start && Date.parse(f.filed) <= stop);
  hits.sort((a, b) => a.filed.localeCompare(b.filed));
  return hits[0] ?? null;
}
