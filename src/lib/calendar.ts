// The calendar of the stocks you follow: when results are expected (a year after the same
// quarter's results, from SEC filings), roughly when the next 10-Q or 10-K is due, and the review
// dates of your theses. Pure: the inputs come from the SEC summaries and your notebook, so it
// spends no price-data quota. Also builds an .ics file to add the dates to another calendar.
import type { FilingRef, SnapshotPayload } from "./snapshotShared";

export type EventKind = "results" | "deadline" | "review";
export const KINDS: EventKind[] = ["results", "deadline", "review"];
export const RANGES = [30, 60, 90] as const;

/** Filing deadlines for large accelerated filers (most companies people follow): days after the period ends. */
export const DEADLINE_DAYS = { "10-Q": 40, "10-K": 60 } as const;

export interface CalEvent {
  date: string; // YYYY-MM-DD
  symbol: string;
  kind: EventKind;
  /** results: the release it's based on; deadline: the form and the period it covers. */
  form?: "10-Q" | "10-K";
  periodEnd?: string;
  basedOn?: string;
}

export interface CalendarInput {
  symbol: string;
  snapshot: SnapshotPayload | null;
  reviewBy: string | null;
}

const DAY = 86_400_000;
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/**
 * The next periodic report and its approximate deadline: the period after the newest report
 * (about 91 days later), a 10-K when that lands on the fiscal year end (within a month), else a 10-Q.
 */
export function nextDeadline(report: FilingRef | null | undefined, annual: FilingRef | null | undefined): { form: "10-Q" | "10-K"; periodEnd: string; due: string } | null {
  if (!report?.reportDate || !/^10-[KQ]/.test(report.form)) return null; // foreign filers (20-F) follow other rules
  const periodEnd = addDays(report.reportDate, 91);
  let isAnnual = false;
  if (annual?.reportDate) {
    const offset = ((daysBetween(annual.reportDate, periodEnd) % 365) + 365) % 365;
    isAnnual = offset <= 31 || offset >= 334;
  }
  const form = isAnnual ? "10-K" : "10-Q";
  return { form, periodEnd, due: addDays(periodEnd, DEADLINE_DAYS[form]) };
}

/** Every event from today through `days` ahead, soonest first (ties: results, deadline, review; then symbol). */
export function buildCalendar(rows: CalendarInput[], today: string, days: number): CalEvent[] {
  const until = addDays(today, days);
  const inRange = (d: string) => d >= today && d <= until;
  const out: CalEvent[] = [];
  for (const r of rows) {
    const f = r.snapshot?.filings.ok ? r.snapshot.filings.data : null;
    if (f?.nextResults && inRange(f.nextResults.date)) out.push({ date: f.nextResults.date, symbol: r.symbol, kind: "results", basedOn: f.nextResults.basedOn });
    const due = f ? nextDeadline(f.report, f.annual) : null;
    if (due && inRange(due.due)) out.push({ date: due.due, symbol: r.symbol, kind: "deadline", form: due.form, periodEnd: due.periodEnd });
    if (r.reviewBy && inRange(r.reviewBy)) out.push({ date: r.reviewBy, symbol: r.symbol, kind: "review" });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.symbol.localeCompare(b.symbol));
}

/** Events grouped by week (Monday first), in order. */
export function byWeek(events: CalEvent[]): { monday: string; events: CalEvent[] }[] {
  const weeks: { monday: string; events: CalEvent[] }[] = [];
  for (const e of events) {
    const dow = new Date(`${e.date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
    const monday = addDays(e.date, -((dow + 6) % 7));
    const last = weeks[weeks.length - 1];
    if (last?.monday === monday) last.events.push(e);
    else weeks.push({ monday, events: [e] });
  }
  return weeks;
}

/** An iCalendar file with one all-day event per date; `title` gives each event its text. */
export function toIcs(events: CalEvent[], title: (e: CalEvent) => string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//IEP Analytics//Calendar//ES", "CALSCALE:GREGORIAN"];
  for (const e of events) {
    const d = e.date.replace(/-/g, "");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.kind}-${e.symbol}-${d}@iep-analytics`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d}`,
      `DTEND;VALUE=DATE:${addDays(e.date, 1).replace(/-/g, "")}`,
      `SUMMARY:${esc(title(e))}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
