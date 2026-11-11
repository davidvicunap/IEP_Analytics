import { describe, expect, it } from "vitest";
import type { StatementSet } from "./secFinancials";
import { earningsRelease, quarterReview } from "./quarterReview";

const cells = (xs: (number | null)[]) => xs.map((value) => ({ value }));
// Five quarters of a September fiscal year; the last one comes from the 10-K.
const set: StatementSet = {
  periods: [
    { label: "Q4 FY2025", end: "2025-09-27", form: "10-K", accn: "A-25-4", filed: "2025-10-31" },
    { label: "Q1 FY2026", end: "2025-12-27", form: "10-Q", accn: "A-26-1", filed: "2026-01-30" },
    { label: "Q2 FY2026", end: "2026-03-28", form: "10-Q", accn: "A-26-2", filed: "2026-05-01" },
    { label: "Q3 FY2026", end: "2026-06-27", form: "10-Q", accn: "A-26-3", filed: "2026-08-01" },
    { label: "Q4 FY2026", end: "2026-09-26", form: "10-K", accn: "A-26-4", filed: "2026-10-30" },
  ],
  lines: {
    revenue: cells([100, 130, 95, 90, 110]),
    grossProfit: cells([45, 60, 44, 42, 53]),
    operatingIncome: cells([30, 40, 28, 26, 34]),
    netIncome: cells([25, 33, -2, 21, 29]),
    epsDiluted: cells([1.0, 1.3, -0.1, 0.85, 1.2]),
    dilutedShares: cells([25, 25, 25, 25, 24]),
    operatingCashFlow: cells([35, 40, 20, 25, 38]),
    capex: cells([-5, -6, -5, -4, -6]),
  },
};

describe("quarter in review", () => {
  const r = quarterReview(set, [])!;
  const row = (k: string) => r.rows.find((x) => x.key === k)!;

  it("compares the latest quarter with the same quarter a year earlier and with the one before", () => {
    expect(r).toMatchObject({ quarter: "2026-Q3", label: "Q4 FY2026", end: "2026-09-26", yearAgoLabel: "Q4 FY2025", priorLabel: "Q3 FY2026" });
    expect(r.filing).toEqual({ accn: "A-26-4", form: "10-K", filed: "2026-10-30" });
    expect(row("revenue")).toMatchObject({ now: 110, yearAgo: 100, prior: 90 });
    expect(row("revenue").vsYearAgo).toBeCloseTo(0.1);
    expect(row("revenue").vsPrior).toBeCloseTo(110 / 90 - 1);
  });

  it("measures margins in points and free cash flow from cash flow minus capex", () => {
    expect(row("grossMargin").now).toBeCloseTo(53 / 110);
    expect(row("grossMargin").vsYearAgo).toBeCloseTo(53 / 110 - 0.45); // points, not percent
    expect(row("freeCashFlow")).toMatchObject({ now: 32, yearAgo: 30 });
  });

  it("gives no percentage when the base is a loss", () => {
    // Four quarters: the latest (Q3 FY2026, net income 21) follows a loss (−2) and has no year-ago quarter.
    const fromLoss = quarterReview({ ...set, periods: set.periods.slice(0, 4), lines: Object.fromEntries(Object.entries(set.lines).map(([k, v]) => [k, v!.slice(0, 4)])) }, [])!;
    expect(fromLoss.label).toBe("Q3 FY2026");
    expect(fromLoss.rows.find((x) => x.key === "netIncome")).toMatchObject({ now: 21, prior: -2, vsPrior: null });
    expect(fromLoss.yearAgoLabel).toBeNull();
  });

  it("gives no percentage when a profit turns into a loss (HIMS Q3 2026: +$15.8M to −$33M)", () => {
    const flip = quarterReview({ periods: [{ label: "Q3 FY2025", end: "2025-09-30" }, { label: "Q3 FY2026", end: "2026-09-30" }], lines: { revenue: cells([599, 890]), netIncome: cells([15.8, -33]) } }, [])!;
    expect(flip.rows.find((x) => x.key === "netIncome")).toMatchObject({ now: -33, yearAgo: 15.8, vsYearAgo: null });
    expect(flip.rows.find((x) => x.key === "revenue")!.vsYearAgo).toBeCloseTo(890 / 599 - 1);
  });

  it("returns nothing without quarterly data", () => {
    expect(quarterReview({ periods: [], lines: {} }, [])).toBeNull();
  });
});

describe("earnings release", () => {
  const f = (form: string, filed: string, items: string[]) => ({ form, filed, items });
  it("is the first 8-K with item 2.02 filed within 75 days after the quarter", () => {
    const filings = [f("8-K", "2026-08-01", ["2.02"]), f("8-K", "2026-10-30", ["2.02", "9.01"]), f("8-K", "2026-10-15", ["5.02"]), f("10-K", "2026-10-30", []), f("8-K", "2027-01-29", ["2.02"])];
    expect(earningsRelease(filings, "2026-09-26")).toEqual(filings[1]);
    expect(earningsRelease(filings, "2027-03-31")).toBeNull();
  });
});
