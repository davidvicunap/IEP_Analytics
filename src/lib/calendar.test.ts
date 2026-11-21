import { describe, expect, it } from "vitest";
import { buildCalendar, byWeek, nextDeadline, toIcs } from "./calendar";
import type { FilingRef, SnapshotPayload } from "./snapshotShared";

const ref = (form: string, reportDate: string, filed = reportDate): FilingRef => ({ accn: `${form}-${reportDate}`, form, filed, reportDate, primaryDocument: "", items: [] });
const snap = (symbol: string, data: Partial<Extract<SnapshotPayload["filings"], { ok: true }>["data"]>): SnapshotPayload => ({
  symbol,
  cik: 1,
  quality: { ok: false, error: "not_found" },
  filings: { ok: true, data: { report: null, latest: null, recent: [], nextResults: null, ...data } },
  insiders: { ok: false, error: "not_found" },
});

describe("filing deadlines", () => {
  it("expects a 10-Q 40 days after the next quarter ends, and a 10-K 60 days after the fiscal year ends", () => {
    // Apple: fiscal year ends late September.
    const annual = ref("10-K", "2025-09-27");
    expect(nextDeadline(ref("10-Q", "2026-06-27"), annual)).toEqual({ form: "10-K", periodEnd: "2026-09-26", due: "2026-11-25" });
    expect(nextDeadline(ref("10-K", "2026-09-26"), ref("10-K", "2026-09-26"))).toEqual({ form: "10-Q", periodEnd: "2026-12-26", due: "2027-02-04" });
    // Calendar-year company after its Q3 10-Q: the next one is the 10-K.
    expect(nextDeadline(ref("10-Q", "2026-09-30"), ref("10-K", "2025-12-31"))?.form).toBe("10-K");
    expect(nextDeadline(ref("20-F", "2025-12-31"), null)).toBeNull();
    expect(nextDeadline(null, null)).toBeNull();
  });
});

describe("the calendar", () => {
  const rows = [
    { symbol: "MSFT", snapshot: snap("MSFT", { nextResults: { date: "2026-12-01", basedOn: "2025-12-02" }, report: ref("10-Q", "2026-09-30"), annual: ref("10-K", "2026-06-30") }), reviewBy: null },
    { symbol: "AAPL", snapshot: snap("AAPL", { nextResults: { date: "2027-03-01", basedOn: "2026-03-01" } }), reviewBy: "2026-12-01" },
    { symbol: "KO", snapshot: null, reviewBy: "2026-11-01" },
  ];

  it("lists results, deadlines and review dates in the window, soonest first", () => {
    // KO's review date has passed; AAPL's results are beyond 60 days; MSFT's 10-Q is due on Feb 8.
    expect(buildCalendar(rows, "2026-11-20", 60)).toEqual([
      { date: "2026-12-01", symbol: "MSFT", kind: "results", basedOn: "2025-12-02" },
      { date: "2026-12-01", symbol: "AAPL", kind: "review" },
    ]);
    expect(buildCalendar(rows, "2026-11-20", 90).at(-1)).toEqual({ date: "2027-02-08", symbol: "MSFT", kind: "deadline", form: "10-Q", periodEnd: "2026-12-30" });
  });

  it("groups by week starting on Monday", () => {
    const weeks = byWeek(buildCalendar(rows, "2026-11-20", 90));
    expect(weeks.map((w) => [w.monday, w.events.length])).toEqual([
      ["2026-11-30", 2],
      ["2027-02-08", 1],
    ]);
  });

  it("exports all-day events for other calendars", () => {
    const ics = toIcs([{ date: "2026-12-01", symbol: "MSFT", kind: "results" }], (e) => `${e.symbol}: results, estimated`, new Date("2026-11-20T10:00:00Z"));
    expect(ics).toContain("DTSTART;VALUE=DATE:20261201\r\nDTEND;VALUE=DATE:20261202");
    expect(ics).toContain("SUMMARY:MSFT: results\\, estimated");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  });
});
