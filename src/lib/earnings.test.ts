import { describe, expect, it } from "vitest";
import { daysUntil, estimateFromReleases, nextListed } from "./earnings";

describe("next earnings date", () => {
  it("takes the first listed date not yet reported", () => {
    const rows = [
      { date: "2027-02-04", epsEstimated: 2.9, revenueEstimated: 156e9, epsActual: null },
      { date: "2026-11-02", epsEstimated: 1.99, revenueEstimated: 113e9, epsActual: 2.05 },
      { date: "2027-04-30", epsEstimated: 1.8, revenueEstimated: 100e9, epsActual: null },
    ];
    expect(nextListed(rows, "2026-11-11")).toEqual({ kind: "listed", date: "2027-02-04", epsEstimate: 2.9, revenueEstimate: 156e9 });
    expect(nextListed(rows.slice(1, 2), "2026-11-11")).toBeNull(); // only past results
    expect(nextListed([{ date: "2026-11-11", epsEstimated: null, revenueEstimated: null, epsActual: null }], "2026-11-11")).toMatchObject({ date: "2026-11-11" }); // today counts
  });

  it("estimates one year (same weekday) after last year's release for the coming quarter", () => {
    const releases = ["2025-10-30", "2026-01-29", "2026-05-01", "2026-07-30", "2026-10-30"];
    expect(estimateFromReleases(releases, "2026-11-11")).toEqual({ kind: "estimated", date: "2027-01-28", basedOn: "2026-01-29" });
    expect(new Date("2027-01-28").getUTCDay()).toBe(new Date("2026-01-29").getUTCDay());
  });

  it("gives no estimate without recent releases", () => {
    expect(estimateFromReleases([], "2026-11-11")).toBeNull();
    expect(estimateFromReleases(["2023-02-01", "2023-05-01"], "2026-11-11")).toBeNull(); // stopped reporting
    expect(estimateFromReleases(["2027-01-01"], "2026-11-11")).toBeNull(); // future dates are ignored
  });

  it("counts days to the date", () => {
    expect(daysUntil("2026-11-11", "2026-11-11")).toBe(0);
    expect(daysUntil("2027-02-04", "2026-11-11")).toBe(85);
  });
});
