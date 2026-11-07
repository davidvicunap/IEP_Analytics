import { describe, expect, it } from "vitest";
import {
  TAX_RATE, applies, businessType, computeRatios, inputsFromStatements, median, percentileRank, ratioNote,
} from "./ratios";
import type { StatementSet } from "./secFinancials";

// Hand-checked example: revenue 1,000, COGS 600, operating income 250, net income 180,
// OCF 300, capex 100, equity 900, assets 2,000, long-term debt 450, prior revenue 800,
// EPS 2.00 vs 1.60.
const base = {
  revenue: 1000, revenuePrev: 800, costOfRevenue: 600, operatingIncome: 250, netIncome: 180,
  eps: 2, epsPrev: 1.6, ocf: 300, capex: 100, equity: 900, assets: 2000, longTermDebt: 450,
};

describe("ratio formulas", () => {
  const r = computeRatios(base);
  it("margins = line ÷ revenue (gross falls back to revenue − cost of revenue)", () => {
    expect(r.grossMargin).toBeCloseTo(0.4);
    expect(r.operatingMargin).toBeCloseTo(0.25);
    expect(r.netMargin).toBeCloseTo(0.18);
    expect(r.fcfMargin).toBeCloseTo(0.2); // (300 − 100) / 1,000
  });
  it("returns on period-end balances; ROIC uses the 21 % statutory rate", () => {
    expect(r.roe).toBeCloseTo(0.2);
    expect(r.roa).toBeCloseTo(0.09);
    expect(r.roic).toBeCloseTo((250 * (1 - TAX_RATE)) / 1350); // 14.63 %
    expect(r.roic).toBeCloseTo(0.14630, 4);
  });
  it("health and growth", () => {
    expect(r.debtToEquity).toBeCloseTo(0.5);
    expect(r.equityToAssets).toBeCloseTo(0.45);
    expect(r.revenueGrowth).toBeCloseTo(0.25);
    expect(r.epsGrowth).toBeCloseTo(0.25);
  });
  it("prefers reported gross profit over the fallback", () => {
    expect(computeRatios({ ...base, grossProfit: 450 }).grossMargin).toBeCloseTo(0.45);
  });
  it("returns null instead of a misleading number on missing inputs or bad bases", () => {
    const bad = computeRatios({ ...base, equity: -50, revenue: 0, epsPrev: -1, capex: undefined });
    expect(bad.roe).toBeNull(); // negative equity
    expect(bad.debtToEquity).toBeNull();
    expect(bad.netMargin).toBeNull(); // zero revenue
    expect(bad.epsGrowth).toBeNull(); // from a loss
    expect(bad.fcfMargin).toBeNull(); // no capex
  });
});

describe("notes", () => {
  it("explains negative equity, inflated ROE and growth from a negative base", () => {
    expect(ratioNote("roe", { ...base, equity: -5 }, "general")).toBe("negativeEquity");
    expect(ratioNote("roe", { ...base, equity: 150 }, "general")).toBe("smallEquity"); // 7.5 % of assets
    expect(ratioNote("roe", { ...base, equity: 150 }, "bank")).toBeNull(); // thin equity is normal for banks
    expect(ratioNote("epsGrowth", { ...base, epsPrev: -0.3 }, "general")).toBe("negativeBase");
    expect(ratioNote("roe", base, "general")).toBeNull();
  });
});

describe("business types", () => {
  it("maps SIC ranges and limits metrics by type", () => {
    expect(businessType(6021)).toBe("bank");
    expect(businessType(6211)).toBe("bank");
    expect(businessType(6331)).toBe("insurance");
    expect(businessType(6798)).toBe("reit");
    expect(businessType(3571)).toBe("general");
    expect(businessType(null)).toBe("general");
    expect(applies("grossMargin", "bank")).toBe(false);
    expect(applies("debtToEquity", "bank")).toBe(false);
    expect(applies("equityToAssets", "bank")).toBe(true);
    expect(applies("equityToAssets", "general")).toBe(false);
    expect(applies("roic", "reit")).toBe(false);
  });
});

describe("percentiles", () => {
  it("counts values below plus half of ties", () => {
    expect(percentileRank([1, 2, 3, 4], 5)).toBe(100);
    expect(percentileRank([1, 2, 3, 4], 0)).toBe(0);
    expect(percentileRank([1, 2, 3, 4], 3)).toBe(63); // (2 + 0.5) / 4
    expect(percentileRank([], 1)).toBeNull();
  });
  it("median of odd and even lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("inputs from statements", () => {
  const cell = (value: number | null) => ({ value });
  const set: StatementSet = {
    periods: [
      { end: "2021-12-31", label: "FY2021" },
      { end: "2022-12-31", label: "FY2022" },
      { end: "2024-12-31", label: "FY2024" }, // FY2023 missing
    ],
    lines: {
      revenue: [cell(100), cell(120), cell(150)],
      netIncome: [cell(10), cell(12), cell(null)],
      equity: [cell(50), cell(60), cell(70)],
    },
  };
  it("uses the prior year only when it is exactly one year earlier", () => {
    const i = inputsFromStatements(set);
    expect(i[1]).toMatchObject({ revenue: 120, revenuePrev: 100, netIncome: 12, equity: 60 });
    expect(i[2].revenuePrev).toBeUndefined();
    expect(i[2].netIncome).toBeUndefined();
    expect(computeRatios(i[1]).revenueGrowth).toBeCloseTo(0.2);
  });
});
