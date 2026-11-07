import { describe, expect, it } from "vitest";
import type { StatementSet } from "./secFinancials";
import { checkColumn, projectStatements, projectionDefaults, ttmColumn } from "./statements";

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

describe("projections", () => {
  const years = [2021, 2022, 2023, 2024, 2025, 2026];
  const annual: StatementSet = {
    periods: years.map((y) => ({ end: `${y}-12-31`, label: `FY${y}` })),
    lines: {
      revenue: [100, 110, 121, 133.1, 146.41, 161.051].map(cell), // +10 %/yr
      grossProfit: [40, 44, 48.4, 53.24, 58.564, 64.4204].map(cell), // 40 %
      operatingIncome: [20, 22, 24.2, 26.62, 29.282, 32.2102].map(cell), // 20 %
      interestExpense: [1, 1.1, 1.21, 1.331, 1.4641, 1.61051].map(cell), // 1 %
      pretaxIncome: [19, 20.9, 22.99, 25.289, 27.8179, 30.59969].map(cell), // op − interest
      incomeTax: [3.8, 4.18, 4.598, 5.0578, 5.56358, 6.119938].map(cell), // 20 %
      netIncome: [15.2, 16.72, 18.392, 20.2312, 22.25432, 24.479752].map(cell),
      dilutedShares: [10, 10, 10, 9.7, 9.5, 9.3].map(cell),
      cash: [5, 5, 5, 5, 5, 20].map(cell),
      totalLiabilities: [50, 50, 50, 50, 50, 60].map(cell),
      equity: [50, 50, 50, 50, 50, 80].map(cell),
      freeCashFlow: [10, 10, 10, 10, 10, 20].map(cell),
      dividendsPaid: [0, 0, 0, 0, 0, 4.895950].map(cell), // 20 % of net income
      buybacks: [0, 0, 0, 0, 0, 5].map(cell), // 25 % of FCF
      depreciation: [5, 5.5, 6.05, 6.655, 7.3205, 8.05255].map(cell), // 5 %
      capex: [6, 6.6, 7.26, 7.986, 8.7846, 9.66306].map(cell), // 6 %
    },
  };
  const d = projectionDefaults(annual)!;

  it("starts from the company's own history", () => {
    expect(d.base).toMatchObject({ label: "FY2026", revenue: 161.051, cash: 20, equity: 80, totalLiabilities: 60, dilutedShares: 9.3 });
    expect(d.assumptions.growth[0]).toBeCloseTo(0.1); // 5-year CAGR, fading after
    expect(d.assumptions.grossMargin![0]).toBeCloseTo(0.4);
    expect(d.assumptions.opMargin[0]).toBeCloseTo(0.2);
    expect(d.assumptions.interestPct[0]).toBeCloseTo(0.01);
    expect(d.assumptions.otherPct[0]).toBeCloseTo(0);
    expect(d.assumptions.taxRate[0]).toBeCloseTo(0.2);
    expect(d.assumptions.payout[0]).toBeCloseTo(0.2);
    expect(d.assumptions.buybackPct[0]).toBeCloseTo(0.25);
    expect(d.assumptions.shareChange[0]).toBeCloseTo((9.3 / 10) ** (1 / 3) - 1);
  });

  it("projects consistent statements: income flows into cash and equity, and the balance sheet balances", () => {
    const flat = { ...d.assumptions, growth: d.assumptions.growth.map(() => 0.1), shareChange: d.assumptions.shareChange.map(() => 0) };
    const p = projectStatements(d.base, flat);
    const y = (k: keyof typeof p.lines, i: number) => p.lines[k]![i].value!;
    expect(p.periods.map((x) => x.label)).toEqual(["FY2027E", "FY2028E", "FY2029E", "FY2030E", "FY2031E"]);
    expect(y("revenue", 0)).toBeCloseTo(177.1561);
    expect(y("grossProfit", 0)).toBeCloseTo(177.1561 * 0.4);
    expect(y("pretaxIncome", 0)).toBeCloseTo(177.1561 * 0.19);
    expect(y("netIncome", 0)).toBeCloseTo(177.1561 * 0.19 * 0.8);
    expect(y("epsDiluted", 0)).toBeCloseTo(y("netIncome", 0) / 9.3);
    const fcf = y("operatingCashFlow", 0) - y("capex", 0);
    expect(y("freeCashFlow", 0)).toBeCloseTo(fcf);
    expect(y("cash", 0)).toBeCloseTo(20 + fcf - y("dividendsPaid", 0) - y("buybacks", 0));
    expect(y("equity", 0)).toBeCloseTo(80 + y("netIncome", 0) - y("dividendsPaid", 0) - y("buybacks", 0));
    for (let i = 0; i < 5; i++) expect(y("totalAssets", i)).toBeCloseTo(y("totalLiabilities", i) + y("equity", i));
    expect(p.lines.revenue!.every((c) => c.derived === "projection")).toBe(true);
  });

  it("projects on pretax income when there is no operating-income line", () => {
    const bank = { ...annual, lines: { ...annual.lines, operatingIncome: undefined, grossProfit: undefined } };
    const b = projectionDefaults(bank)!;
    expect(b.assumptions.opMargin[0]).toBeCloseTo(0.19);
    expect(b.assumptions.interestPct[0]).toBe(0);
    expect(b.assumptions.grossMargin).toBeNull();
  });

  it("falls back to cover-page shares and needs revenue", () => {
    const noShares = { ...annual, lines: { ...annual.lines, dilutedShares: undefined } };
    expect(projectionDefaults(noShares)).toBeNull();
    expect(projectionDefaults(noShares, 9)!.base.dilutedShares).toBe(9);
  });
});
