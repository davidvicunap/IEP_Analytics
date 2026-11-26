// "Your companies" on the hub: every stock you have a thesis on, hold or follow, in one list,
// each with the one next thing worth knowing. Pure: the hub gathers the inputs (notebooks,
// trades, the followed list, thesis alerts, SEC summaries) and renders the result.
import { daysUntil } from "./earnings";
import type { FilingRef } from "./snapshotShared";

export interface CompanyRow {
  symbol: string;
  /** A notebook exists for it (open or closed). */
  thesis: boolean;
  /** Shares are open in the trade record. */
  held: boolean;
  /** On the followed list. */
  followed: boolean;
}

/**
 * One row per stock: notebooks first (in their order, newest edit first), then stocks held
 * without one, then stocks only followed (in the order you followed them). A symbol appears once.
 */
export function companyRows(input: { notes: string[]; held: string[]; followed: string[] }): CompanyRow[] {
  const notes = new Set(input.notes);
  const held = new Set(input.held);
  const followed = new Set(input.followed);
  const order = [...new Set([...input.notes, ...input.held, ...input.followed])];
  return order.map((symbol) => ({ symbol, thesis: notes.has(symbol), held: held.has(symbol), followed: followed.has(symbol) }));
}

/** Results this close are worth a line; further out, the stock page has the date. */
export const RESULTS_WINDOW_DAYS = 45;
/** A filing is news for this long. */
export const FILING_NEWS_DAYS = 7;

export type NextEvent =
  | { kind: "alert"; count: number }
  | { kind: "filed"; form: string; filed: string; accn: string }
  | { kind: "results"; date: string; days: number };

/**
 * The one thing to know next, most pressing first: alerts on your thesis that you haven't marked
 * as seen, then a filing about the business in the last week, then results expected soon.
 * Nothing when none applies (the row stays quiet).
 */
export function nextEvent(input: {
  alerts: number;
  recent: FilingRef[];
  nextResults: { date: string } | null;
  today: string;
}): NextEvent | null {
  if (input.alerts > 0) return { kind: "alert", count: input.alerts };
  const fresh = input.recent.find((f) => daysUntil(input.today, f.filed) <= FILING_NEWS_DAYS && f.filed <= input.today);
  if (fresh) return { kind: "filed", form: fresh.form, filed: fresh.filed, accn: fresh.accn };
  if (input.nextResults) {
    const days = daysUntil(input.nextResults.date, input.today);
    if (days >= 0 && days <= RESULTS_WINDOW_DAYS) return { kind: "results", date: input.nextResults.date, days };
  }
  return null;
}
