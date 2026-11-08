import { describe, expect, it } from "vitest";
import type { StatementSet } from "./secFinancials";
import {
  METRICS,
  buildChartData,
  calendarQuarter,
  comparePeriodKeys,
  compatible,
  fundamentalSeries,
  niceTicks,
  type PeriodSeries,
  type SeriesSpec,
} from "./chartMetrics";

const cells = (xs: (number | null)[]) => xs.map((value) => ({ value }));

describe("fundamentalSeries", () => {
  // Four fiscal years with a 4-for-1 split between the second and third.
  const set: StatementSet = {
    periods: [2021, 2022, 2023, 2024].map((y) => ({ end: `${y}-09-30`, label: `FY${y}` })),
    lines: {
      revenue: cells([100, 120, 150, 180]),
      costOfRevenue: cells([60, 70, 80, 90]),
      operatingIncome: cells([20, 30, 40, 50]),
      depreciation: cells([5, 5, 6, 6]),
      netIncome: cells([15, 24, 30, 36]),
      epsDiluted: cells([1.5, 2.4, 0.75, 0.9]),
      dilutedShares: cells([10, 10, 40, 40]),
      operatingCashFlow: cells([25, 30, 45, 55]),
      capex: cells([-5, -6, -9, -10]),
      dividendsPaid: cells([-4, -4, -8, -8]),
      buybacks: cells([-10, null, -12, -14]),
      equity: cells([50, 60, 80, -10]),
      totalAssets: cells([200, 220, 260, 300]),
      longTermDebt: cells([30, 30, 20, null]),
      currentDebt: cells([null, 5, 5, null]),
      cash: cells([10, 12, 14, 16]),
    },
  };
  const splits = [{ after: "2022-07-01", before: "2022-10-15", ratio: 4 }];
  const s = fundamentalSeries(set, splits, "annual");

  it("keys periods by fiscal year, oldest first", () => {
    expect(s.keys).toEqual(["FY2021", "FY2022", "FY2023", "FY2024"]);
    expect(s.ends[0]).toBe("2021-09-30");
  });

  it("restates per-share figures and share counts to today's basis", () => {
    expect(s.values.shares).toEqual([40, 40, 40, 40]);
    expect(s.values.eps?.[0]).toBeCloseTo(0.375);
    expect(s.values.eps?.[3]).toBeCloseTo(0.9);
    expect(s.values.dividendsPerShare?.[0]).toBeCloseTo(0.1);
  });

  it("derives gross profit, EBITDA, FCF and margins when not reported", () => {
    expect(s.values.grossProfit).toEqual([40, 50, 70, 90]);
    expect(s.values.ebitda).toEqual([25, 35, 46, 56]);
    expect(s.values.freeCashFlow).toEqual([20, 24, 36, 45]);
    expect(s.values.grossMargin?.[3]).toBeCloseTo(0.5);
    expect(s.values.fcfMargin?.[0]).toBeCloseTo(0.2);
  });

  it("shows outflows as positive amounts and leaves gaps empty", () => {
    expect(s.values.capex).toEqual([5, 6, 9, 10]);
    expect(s.values.buybacks).toEqual([10, null, 12, 14]);
    expect(s.values.debt).toEqual([30, 35, 25, null]);
  });

  it("never divides by negative equity, but shows a negative book value", () => {
    expect(s.values.roe?.[0]).toBeCloseTo(0.3);
    expect(s.values.roe?.[3]).toBeNull();
    expect(s.values.debtToEquity?.[3]).toBeNull();
    expect(s.values.bookValuePerShare?.[3]).toBeCloseTo(-0.25);
  });

  it("leaves annual-only returns empty in quarterly series", () => {
    const q = fundamentalSeries(set, splits, "quarterly");
    expect(q.keys).toEqual(["2021-Q3", "2022-Q3", "2023-Q3", "2024-Q3"]);
    expect(q.values.roe?.every((v) => v === null)).toBe(true);
    expect(q.values.roic?.every((v) => v === null)).toBe(true);
  });

  it("covers every fundamental metric in the catalogue", () => {
    const fundamentals = METRICS.filter((m) => m.group !== "market" && m.group !== "valuation").map((m) => m.key);
    expect(Object.keys(s.values).sort()).toEqual([...fundamentals].sort());
  });
});

describe("calendarQuarter", () => {
  it("uses the calendar quarter of the period end", () => {
    expect(calendarQuarter("2024-03-31")).toBe("2024-Q1");
    expect(calendarQuarter("2024-12-31")).toBe("2024-Q4");
  });
  it("counts ends a few days into a month for the month before (52/53-week years)", () => {
    expect(calendarQuarter("2024-10-05")).toBe("2024-Q3"); // fiscal quarter ending early October
    expect(calendarQuarter("2025-01-03")).toBe("2024-Q4");
  });
});

describe("comparePeriodKeys", () => {
  it("sorts each kind of key chronologically", () => {
    expect(["FY2024", "FY2019", "FY2021"].sort(comparePeriodKeys)).toEqual(["FY2019", "FY2021", "FY2024"]);
    expect(["2024-Q1", "2023-Q4", "2023-Q2"].sort(comparePeriodKeys)).toEqual(["2023-Q2", "2023-Q4", "2024-Q1"]);
    expect(["2024-10", "2024-02", "2023-12"].sort(comparePeriodKeys)).toEqual(["2023-12", "2024-02", "2024-10"]);
  });
});

describe("buildChartData", () => {
  const a: PeriodSeries = { keys: ["FY2020", "FY2021", "FY2022", "FY2023"], ends: [], values: { revenue: [100, 110, 121, 133.1], netMargin: [0.1, 0.12, 0.11, 0.1] } };
  const b: PeriodSeries = { keys: ["FY2022", "FY2023", "FY2024"], ends: [], values: { revenue: [50, -5, 60] } };
  const spec = (symbol: string, metric: SeriesSpec["metric"]): SeriesSpec => ({ id: `${symbol}:${metric}`, symbol, metric });

  it("aligns companies on one axis and leaves missing periods empty", () => {
    const d = buildChartData([spec("A", "revenue"), spec("B", "revenue")], { A: a, B: b }, "annual", "values", 0);
    expect(d.categories).toEqual(["FY2020", "FY2021", "FY2022", "FY2023", "FY2024"]);
    expect(d.series[0].values).toEqual([100, 110, 121, 133.1, null]);
    expect(d.series[1].values).toEqual([null, null, 50, -5, 60]);
    expect(d.unit).toBe("usd");
  });

  it("keeps the last periods of the range", () => {
    const d = buildChartData([spec("A", "revenue")], { A: a }, "annual", "values", 2);
    expect(d.categories).toEqual(["FY2022", "FY2023"]);
    expect(d.series[0].values).toEqual([121, 133.1]);
  });

  it("computes growth from the period before the window, and never from a negative base", () => {
    const d = buildChartData([spec("A", "revenue"), spec("B", "revenue")], { A: a, B: b }, "annual", "growth", 2);
    expect(d.categories).toEqual(["FY2023", "FY2024"]);
    expect(d.series[0].values[0]).toBeCloseTo(0.1);
    expect(d.series[1].values[0]).toBeCloseTo(-1.1);
    expect(d.series[1].values[1]).toBeNull(); // from −5: meaningless
    expect(d.unit).toBe("pct");
  });

  it("uses the same quarter a year earlier for quarterly growth", () => {
    const q: PeriodSeries = { keys: ["2023-Q1", "2023-Q2", "2023-Q3", "2023-Q4", "2024-Q1"], ends: [], values: { revenue: [10, 20, 30, 40, 12] } };
    const d = buildChartData([spec("A", "revenue")], { A: q }, "quarterly", "growth", 0);
    expect(d.series[0].values.slice(0, 4)).toEqual([null, null, null, null]);
    expect(d.series[0].values[4]).toBeCloseTo(0.2);
  });

  it("indexes each series to 100 at its first positive value in the window", () => {
    const d = buildChartData([spec("A", "revenue"), spec("B", "revenue")], { A: a, B: b }, "annual", "index", 0);
    expect(d.series[0].values[0]).toBe(100);
    expect(d.series[0].values[3]).toBeCloseTo(133.1);
    expect(d.series[1].values[2]).toBe(100);
    expect(d.series[1].values[4]).toBe(120);
    expect(d.unit).toBe("index");
  });

  it("returns empty series for a company that hasn't loaded", () => {
    const d = buildChartData([spec("A", "revenue"), spec("Z", "revenue")], { A: a, Z: undefined }, "annual", "values", 0);
    expect(d.series[1].values.every((v) => v === null)).toBe(true);
  });
});

describe("compatible", () => {
  it("only lets same-unit metrics share an axis, unless transformed", () => {
    expect(compatible(["revenue", "netIncome"], "values")).toBe(true);
    expect(compatible(["revenue", "netMargin"], "values")).toBe(false);
    expect(compatible(["revenue", "netMargin"], "growth")).toBe(true);
    expect(compatible(["revenue", "netMargin"], "index")).toBe(true);
  });
});

describe("niceTicks", () => {
  it("covers the range with round steps", () => {
    expect(niceTicks(0, 97)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(-0.12, 0.31)).toEqual([-0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4]);
    expect(niceTicks(0, 3.9e11, 5)).toEqual([0, 1e11, 2e11, 3e11, 4e11]);
  });
  it("pads a flat series", () => {
    const t = niceTicks(50, 50);
    expect(t[0]).toBeLessThan(50);
    expect(t.at(-1)).toBeGreaterThan(50);
  });
});
