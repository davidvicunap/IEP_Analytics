import { describe, expect, it } from "vitest";
import { companyRows, nextEvent } from "./companies";
import type { FilingRef } from "./snapshotShared";

const filing = (form: string, filed: string): FilingRef => ({ accn: `acc-${form}-${filed}`, form, filed, reportDate: null, primaryDocument: "a.htm", items: [] });

describe("company rows", () => {
  it("lists notebooks first, then held, then followed, each symbol once with all its roles", () => {
    const rows = companyRows({ notes: ["KO", "MSFT"], held: ["NVDA", "KO"], followed: ["AAPL", "MSFT", "NVDA"] });
    expect(rows.map((r) => r.symbol)).toEqual(["KO", "MSFT", "NVDA", "AAPL"]);
    expect(rows[0]).toEqual({ symbol: "KO", thesis: true, held: true, followed: false });
    expect(rows[1]).toEqual({ symbol: "MSFT", thesis: true, held: false, followed: true });
    expect(rows[2]).toEqual({ symbol: "NVDA", thesis: false, held: true, followed: true });
    expect(rows[3]).toEqual({ symbol: "AAPL", thesis: false, held: false, followed: true });
  });

  it("is empty with nothing to show", () => {
    expect(companyRows({ notes: [], held: [], followed: [] })).toEqual([]);
  });
});

describe("next event", () => {
  const today = "2026-11-26";

  it("puts unseen alerts first", () => {
    expect(nextEvent({ alerts: 2, recent: [filing("10-Q", "2026-11-25")], nextResults: { date: "2026-12-01" }, today })).toEqual({ kind: "alert", count: 2 });
  });

  it("then a filing from the last week, newest first as the snapshot gives them", () => {
    expect(nextEvent({ alerts: 0, recent: [filing("8-K", "2026-11-24"), filing("10-Q", "2026-11-20")], nextResults: null, today })).toMatchObject({ kind: "filed", form: "8-K", filed: "2026-11-24" });
    expect(nextEvent({ alerts: 0, recent: [filing("10-Q", "2026-11-10")], nextResults: null, today })).toBeNull();
  });

  it("then results within the window, with the days to go", () => {
    expect(nextEvent({ alerts: 0, recent: [], nextResults: { date: "2026-12-11" }, today })).toEqual({ kind: "results", date: "2026-12-11", days: 15 });
    expect(nextEvent({ alerts: 0, recent: [], nextResults: { date: today }, today })).toMatchObject({ days: 0 });
    expect(nextEvent({ alerts: 0, recent: [], nextResults: { date: "2027-02-20" }, today })).toBeNull(); // too far to be news
    expect(nextEvent({ alerts: 0, recent: [], nextResults: { date: "2026-11-20" }, today })).toBeNull(); // already past
  });
});
