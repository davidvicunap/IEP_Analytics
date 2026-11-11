// The next earnings date: the date FMP lists (with analysts' estimates) or, when FMP can't be
// asked, an estimate from the company's own SEC history (results come out around the same week
// every year). Pure: the sources are read in earningsData.ts.

export interface FmpEarningsRow {
  date: string; // YYYY-MM-DD
  epsEstimated: number | null;
  revenueEstimated: number | null;
  epsActual: number | null;
}

export type NextEarnings =
  | { kind: "listed"; date: string; epsEstimate: number | null; revenueEstimate: number | null }
  /** Estimated: one year (52 weeks, same weekday) after the release for the same quarter last year. */
  | { kind: "estimated"; date: string; basedOn: string }
  | { kind: "unknown" };

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The first listed date from today on that hasn't reported yet. */
export function nextListed(rows: FmpEarningsRow[], today: string): NextEarnings | null {
  const next = rows
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.date >= today && r.epsActual === null)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  return next ? { kind: "listed", date: next.date, epsEstimate: next.epsEstimated, revenueEstimate: next.revenueEstimated } : null;
}

/**
 * From past results releases (8-K item 2.02), the next one expected: the earliest release
 * moved forward 52 weeks that still falls after today. Only releases from the last ~15
 * months count, so a company that stopped reporting gets no date.
 */
export function estimateFromReleases(releaseDates: string[], today: string): NextEarnings | null {
  const now = Date.parse(today);
  const recent = releaseDates.map((d) => Date.parse(d)).filter((t) => Number.isFinite(t) && t <= now && t > now - 460 * DAY);
  const candidates = recent.map((t) => ({ basedOn: t, next: t + 364 * DAY })).filter((c) => c.next > now);
  if (!candidates.length) return null;
  const best = candidates.sort((a, b) => a.next - b.next)[0];
  return { kind: "estimated", date: iso(best.next), basedOn: iso(best.basedOn) };
}

/** Days from today to `date` (0 = today). */
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(date) - Date.parse(today)) / DAY);
}
