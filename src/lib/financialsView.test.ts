import { describe, expect, it } from "vitest";
import { STATEMENT_ROWS, cagr, change, findings, fmtPct, fmtPerShare, fmtScaled, metricSeries, notReportedSince, pickScale, shownValue } from "./financialsView";
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

  it("a cell reads as a value, a share of revenue or assets, or a change", () => {
    const capex = STATEMENT_ROWS.cashflow.find((r) => r.key === "capex")!;
    const eps = STATEMENT_ROWS.income.find((r) => r.key === "epsDiluted")!;
    const cur = { revenue: { value: 200 }, capex: { value: 10 }, epsDiluted: { value: 2 }, totalAssets: { value: 400 }, cash: { value: 40 } };
    const prev = { revenue: { value: 160 }, capex: { value: 8 }, epsDiluted: { value: 1.6 } };
    expect(shownValue(capex, cur, prev, "values", "cashflow")).toBe(-10);
    expect(shownValue(capex, cur, prev, "common", "cashflow")).toBeCloseTo(-0.05);
    expect(shownValue(capex, cur, prev, "growth", "cashflow")).toBeCloseTo(0.25);
    expect(shownValue(eps, cur, prev, "common", "income")).toBeNull();
    expect(shownValue(eps, cur, null, "growth", "income")).toBeNull();
    expect(shownValue({ key: "cash" }, cur, null, "common", "balance")).toBeCloseTo(0.1);
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
    // Short-term investments reported last year but not this one: no cash figure at all.
    const gap = set({ revenue: [100, 120], cash: [5, 5], shortTermInvestments: [40, null], longTermDebt: [8, 8] }, 2);
    expect(findings(gap).some((x) => x.kind === "netCash" || x.kind === "netDebt")).toBe(false);
    expect(findings(set({ revenue: [-5, 10], netIncome: [-1, -2] }, 2)).map((x) => x.kind)).toEqual([]);
  });

  it("key metric series, with the operating margin computed per year", () => {
    expect(metricSeries(annual, "operatingMargin")[0]).toBeCloseTo(0.2);
    expect(metricSeries(annual, "revenue")).toEqual([100, 110, 120, 130, 140, 161]);
  });
});
