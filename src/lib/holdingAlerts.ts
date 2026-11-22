// Alerts for what the user owns, with or without a thesis: the things a broker doesn't tell you.
// Results coming today or tomorrow, and a new 10-Q/10-K filed in the last two days. Keys start
// with "holding:" so they live beside a thesis's alerts without either clearing the other's. Pure.
import { TONE, type Signal, type SignalKind, type ThesisFacts } from "./thesis";

export const HOLDING = "holding:";
export const isHoldingKey = (key: string) => key.startsWith(HOLDING);
export const RESULTS_NOTICE_DAYS = 1;
export const REPORT_NOTICE_DAYS = 2;

const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * The signals for one holding. `skip` leaves out what the stock's thesis already watches (its own
 * "results soon" or "new report" condition), so the same news doesn't arrive twice.
 */
export function holdingSignals(f: ThesisFacts, today: string, skip: { results?: boolean; report?: boolean } = {}): { signals: Signal[]; unchecked: SignalKind[] } {
  const signals: Signal[] = [];
  const unchecked: SignalKind[] = [];
  if (f.nextResults === null || f.report === null) unchecked.push("results", "report");
  const next = f.nextResults?.date;
  if (!skip.results && next) {
    const d = days(today, next);
    if (d >= 0 && d <= RESULTS_NOTICE_DAYS) signals.push({ key: `${HOLDING}results:${next}`, kind: "results", tone: TONE.results, data: { date: next } });
  }
  const r = f.report;
  if (!skip.report && r) {
    const age = days(r.filed, today);
    if (age >= 0 && age <= REPORT_NOTICE_DAYS) signals.push({ key: `${HOLDING}report:${r.accn}`, kind: "report", tone: TONE.report, data: { form: r.form, filed: r.filed, accn: r.accn } });
  }
  return { signals, unchecked };
}
