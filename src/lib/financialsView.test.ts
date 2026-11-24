import { describe, expect, it } from "vitest";
import { cagr, change, findings, fmtPct, fmtPerShare, fmtScaled, metricSeries, notReportedSince, pickScale } from "./financialsView";
import type { Cell, LineKey, StatementSet } from "./secFinancials";

const set = (rows: Partial<Record<LineKey, (number | null)[]>>, years = 6): StatementSet => ({
  periods: Array.from({ length: years }, (_, i) => ({ end: `${2020 + i}-09-30`, label: `FY${2020 + i}` })),
  lines: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v!.map((value): Cell => ({ value }))])),
});

describe("units and formatting", () => {
  it("one unit per table, short figures, negatives in parentheses", () => {
    expect(pickScale(416e9)).toEqual({ div: 1e9, unit: "B", digits: 1 });
    expect(pickScale(950e6)).toEqual({ div: 1e6, unit: "M", digits: 0 });
    expect(pickScale(25e6)).toEqual({ div: 1e6, unit: "M", digits: 1 });
    expect(pickScale(400e3).unit).toBe("K");
    expect(fmtScaled(416_161e6, pickScale(416e9), "es")).toBe("416.2");
    expect(fmtScaled(-12_345e6, pickScale(950e6), "en")).toBe("(12,345)");
    expect(fmtScaled(null, pickScale(1), "en")).toBe("—");
    expect(fmtPerShare(-1.5, "en")).toBe("(1.50)");
    expect(fmtPct(0.3204, "es")).toBe("32.0%");
    expect(fmtPct(-0.05, "en")).toBe("(5.0%)");
  });

  it("growth only between positive values; change against the previous value", () => {
    expect(cagr(100, 200, 5)).toBeCloseTo(0.1487, 4);
    expect(cagr(-10, 200, 5)).toBeNull();
    expect(cagr(100, 200, 0)).toBeNull();
    expect(change(100, 90)).toBeCloseTo(-0.1);
    expect(change(-100, -50)).toBeCloseTo(0.5);
    expect(change(0, 5)).toBeNull();
  });

  it("a line the company stopped reporting says since when", () => {
    const periods = set({}, 6).periods;
    const cells = [1, 2, 3, null, null, null].map((value): Cell => ({ value }));
    expect(notReportedSince(cells, periods)).toBe("FY2023");
    expect(notReportedSince([1, 2, 3, 4, 5, null].map((value): Cell => ({ value })), periods)).toBeNull();
  });
});

describe("findings from the statements", () => {
  const annual = set({
    revenue: [100, 110, 120, 130, 140, 161],
    operatingIncome: [20, 22, 25, 27, 30, 40],
    netIncome: [15, 16, 18, 20, 22, 30],
    freeCashFlow: [16, 17, 19, 21, 24, 33],
    dilutedShares: [10, 9.8, 9.6, 9.4, 9.2, 9],
    dividendsPaid: [2, 2, 2, 2, 2, 2],
    buybacks: [5, 5, 5, 5, 5, 5],
    cash: [30, 30, 30, 30, 30, 40],
    shortTermInvestments: [null, null, null, null, null, 10],
    longTermDebt: [20, 20, 20, 20, 20, 20],
    stockComp: [1, 1, 1, 1, 1, 3.22],
    researchDevelopment: [5, 5, 5, 5, 5, 8.05],
  });

  it("states growth, margin, cash conversion, shares, payout, net cash, stock pay and R&D", () => {
    const f = findings(annual);
    const by = Object.fromEntries(f.map((x) => [x.kind, x]));
    expect(by.growth).toMatchObject({ from: 100, to: 161, fromLabel: "FY2020", toLabel: "FY2025", years: 5 });
    expect((by.growth as { cagr: number }).cagr).toBeCloseTo(0.1, 2);
    expect(by.margin).toMatchObject({ from: 0.2 });
    expect((by.margin as { to: number }).to).toBeCloseTo(40 / 161);
    // Five full years of flows: FY2021–FY2025.
    expect((by.cashConversion as { ratio: number }).ratio).toBeCloseTo(114 / 106);
    expect((by.shares as { change: number }).change).toBeCloseTo(-0.1);
    expect((by.payout as { share: number }).share).toBeCloseTo(35 / 114);
    expect(by.netCash).toMatchObject({ amount: 30, label: "FY2025" });
    expect((by.stockComp as { ofRevenue: number }).ofRevenue).toBeCloseTo(0.02);
    expect((by.rnd as { ofRevenue: number }).ofRevenue).toBeCloseTo(0.05);
  });

  it("net debt is measured in years of free cash flow; nothing is said without the figures", () => {
    const debtor = set({ revenue: [100, 120], freeCashFlow: [10, 10], cash: [5, 5], longTermDebt: [50, 45] }, 2);
    expect(findings(debtor).find((x) => x.kind === "netDebt")).toMatchObject({ amount: 40, fcfYears: 4 });
    expect(findings(set({ revenue: [100] }, 1))).toEqual([]);
    expect(findings(set({ revenue: [-5, 10], netIncome: [-1, -2] }, 2)).map((x) => x.kind)).toEqual([]);
  });

  it("key metric series, with the operating margin computed per year", () => {
    expect(metricSeries(annual, "operatingMargin")[0]).toBeCloseTo(0.2);
    expect(metricSeries(annual, "revenue")).toEqual([100, 110, 120, 130, 140, 161]);
  });
});
