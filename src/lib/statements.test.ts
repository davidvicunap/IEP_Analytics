import { describe, expect, it } from "vitest";
import type { StatementSet } from "./secFinancials";
import { checkColumn, ttmColumn } from "./statements";

const cell = (value: number | null) => ({ value });

describe("TTM column", () => {
  // FY ends 2025-12-31; three quarters of 2026 follow.
  const q: StatementSet = {
    periods: [
      { end: "2025-09-30", label: "Q3 FY2025" },
      { end: "2025-12-31", label: "Q4 FY2025" },
      { end: "2026-03-31", label: "Q1 FY2026", accn: "a1" },
      { end: "2026-06-30", label: "Q2 FY2026", accn: "a2" },
      { end: "2026-09-30", label: "Q3 FY2026", accn: "a3", form: "10-Q" },
    ],
    lines: {
      revenue: [cell(90), cell(100), cell(110), cell(120), cell(130)],
      netIncome: [cell(9), cell(10), cell(11), cell(12), cell(13)],
      freeCashFlow: [cell(5), cell(6), cell(null), cell(8), cell(9)],
      dilutedShares: [cell(10), cell(10), cell(10), cell(10), cell(9.5)],
      epsDiluted: [cell(0.9), cell(null), cell(1.1), cell(1.2), cell(1.37)],
      cash: [cell(1), cell(2), cell(3), cell(4), { value: 5, concept: "Cash", accn: "a3" }],
    },
  };
  const t = ttmColumn(q, "2025-12-31")!;
  it("sums the last four quarters and takes balances from the last one", () => {
    expect(t.period).toMatchObject({ label: "TTM", end: "2026-09-30", accn: "a3" });
    expect(t.cells.revenue).toEqual({ value: 460, derived: "ttm" });
    expect(t.cells.netIncome?.value).toBe(46);
    expect(t.cells.cash).toMatchObject({ value: 5, concept: "Cash" });
  });
  it("leaves a sum empty when a quarter is missing, and derives EPS from TTM income", () => {
    expect(t.cells.freeCashFlow?.value).toBeNull();
    expect(t.cells.epsDiluted).toEqual({ value: 46 / 9.5, derived: "ttm" });
    expect(t.cells.dilutedShares?.value).toBe(9.5);
  });
  it("isn't shown when the last quarter closes the fiscal year", () => {
    expect(ttmColumn(q, "2026-09-30")).toBeNull();
  });
});

describe("checks", () => {
  it("passes consistent figures", () => {
    const r = checkColumn(
      { revenue: cell(100), costOfRevenue: cell(60), grossProfit: cell(40), totalAssets: cell(500), totalLiabilities: cell(300), equity: cell(195) },
      { revenue: 100.5, netIncome: undefined },
    );
    expect(r).toEqual({ ok: true, issues: [], checked: 3 });
  });
  it("flags gross profit, balance sheet and second-source differences", () => {
    const r = checkColumn(
      { revenue: cell(100), costOfRevenue: cell(60), grossProfit: cell(45), totalAssets: cell(500), totalLiabilities: cell(300), equity: cell(150), netIncome: cell(10) },
      { revenue: 90, netIncome: 10 },
    );
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.kind)).toEqual(["gross", "balance", "source"]);
    expect(r.issues[2]).toMatchObject({ line: "revenue", sec: 100, other: 90 });
  });
});
