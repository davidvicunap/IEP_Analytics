import { describe, expect, it } from "vitest";
import reference from "./__fixtures__/dcf-reference.json";
import {
  cagr, impliedRevenueGrowth, makerDefaults, runDcf, sensitivity, waccOf, type MakerAssumptions, type MakerBase,
} from "./dcfModel";

const TOLERANCE = 0.005; // acceptance criterion: within 0.5 % of the reference sheet

describe("DCF maker vs the independent reference (5 tickers, real inputs)", () => {
  for (const c of reference.cases) {
    it(`${c.symbol}: Gordon and exit multiple, mid-year and year-end, implied growth`, () => {
      const base = c.base as MakerBase;
      const a = c.assumptions as MakerAssumptions;
      expect(Math.abs(waccOf(base, a).wacc / c.expected.wacc - 1)).toBeLessThan(TOLERANCE);
      for (const terminal of ["gordon", "exit"] as const) {
        for (const mid of [true, false]) {
          const r = runDcf(base, { ...a, terminal, midYear: mid });
          if (!r.ok) throw new Error(r.issue);
          const exp = c.expected[`${terminal}-${mid ? "mid" : "end"}` as "gordon-mid"];
          expect(Math.abs(r.result.ev / exp.ev - 1)).toBeLessThan(TOLERANCE);
          expect(Math.abs(r.result.perShare / exp.perShare - 1)).toBeLessThan(TOLERANCE);
        }
      }
      const { g } = impliedRevenueGrowth(base, a);
      expect(Math.abs(g! / c.expected.impliedGrowth - 1)).toBeLessThan(TOLERANCE);
    });
  }
});

// A case small enough to check by hand.
const base: MakerBase = { revenue0: 1000, marketCap: 900, price: 9, debt: 100, cash: 50 };
const flat: MakerAssumptions = {
  growth: [0, 0], ebitMargin: [0.2, 0.2], daPct: [0.05, 0.05], capexPct: [0.05, 0.05], nwcPct: [0, 0],
  taxRate: 0.25, rf: 0.04, beta: 1, erp: 0.05, costOfDebt: 0.06, waccOverride: 0.1,
  terminal: "gordon", terminalGrowth: 0, exitMultiple: 8, midYear: false,
};

describe("model by hand", () => {
  it("flat business: FCFF = NOPAT, value = FCFF ÷ WACC", () => {
    const r = runDcf(base, flat);
    if (!r.ok) throw new Error(r.issue);
    expect(r.result.years[0].fcff).toBeCloseTo(150); // 200 × 0.75 + 50 − 50
    expect(r.result.ev).toBeCloseTo(1500); // perpetuity of 150 at 10 %
    expect(r.result.equity).toBeCloseTo(1450); // − 100 debt + 50 cash
    expect(r.result.perShare).toBeCloseTo(14.5); // 100 shares
    expect(r.result.upside).toBeCloseTo(14.5 / 9 - 1);
    expect(r.result.impliedExitMultiple).toBeCloseTo(1500 / 250);
    expect(r.result.impliedTerminalGrowth).toBeCloseTo(0);
  });

  it("WACC from market-value weights", () => {
    const w = waccOf(base, { ...flat, waccOverride: null });
    expect(w.costOfEquity).toBeCloseTo(0.09);
    expect(w.afterTaxCostOfDebt).toBeCloseTo(0.045);
    expect(w.weightDebt).toBeCloseTo(0.1);
    expect(w.wacc).toBeCloseTo(0.9 * 0.09 + 0.1 * 0.045);
  });

  it("charges working capital on revenue growth only", () => {
    const r = runDcf(base, { ...flat, growth: [0.1, 0], nwcPct: [0.2, 0.2] });
    if (!r.ok) throw new Error(r.issue);
    expect(r.result.years[0].dNwc).toBeCloseTo(20); // 100 more revenue × 20 %
    expect(r.result.years[1].dNwc).toBeCloseTo(0);
  });

  it("rejects inputs that make no sense", () => {
    expect(runDcf(base, { ...flat, waccOverride: 0.02, terminalGrowth: 0.03 })).toEqual({ ok: false, issue: "rateBelowGrowth" });
    expect(runDcf(base, { ...flat, waccOverride: 0 })).toEqual({ ok: false, issue: "badRate" });
    expect(runDcf(base, { ...flat, ebitMargin: [0.2, -0.5] })).toEqual({ ok: false, issue: "negativeTerminal" });
    expect(runDcf(base, { ...flat, growth: [0, NaN] })).toEqual({ ok: false, issue: "badInputs" });
  });

  it("sensitivity grid is centred on the current inputs", () => {
    const s = sensitivity(base, flat, [-0.01, 0, 0.01], [-0.01, 0, 0.01]);
    expect(s.waccs[1]).toBeCloseTo(0.1);
    expect(s.grid[1][1]).toBeCloseTo(14.5);
    expect(s.grid[0][1]!).toBeGreaterThan(s.grid[2][1]!); // lower WACC → higher value
  });
});

describe("defaults", () => {
  const data = {
    revenue: 1000, ebit: 200, da: 50, capex: 110, incomeTax: 40, pretaxIncome: 200, interestExpense: 5,
    revenueCagr5: 0.12, rf: 0.0486, erp: 0.0446, beta: 1.2,
  };
  it("traceable starting assumptions", () => {
    const { assumptions: a, conventions } = makerDefaults(data, base);
    expect(a.growth).toEqual([0.12, 0.101, 0.082, 0.063, 0.044]); // fades towards 2.5 %
    expect(a.ebitMargin.every((m) => m === 0.2)).toBe(true);
    expect(a.capexPct[0]).toBeCloseTo(0.098); // 11 % converging to D&A (5 %)…
    expect(a.capexPct[4]).toBeCloseTo(0.05); // …by the last year
    expect(a.taxRate).toBe(0.2);
    expect(a.costOfDebt).toBe(0.05); // 5 interest ÷ 100 debt
    expect(a.exitMultiple).toBe(4); // EV 950 ÷ EBITDA 250 = 3.8, floored at 4
    expect(conventions).toEqual(["nwcPct"]);
  });
  it("says which defaults are conventions rather than data", () => {
    const { assumptions: a, conventions } = makerDefaults({ ...data, ebit: null, interestExpense: null, rf: null, beta: null }, base);
    expect(a.ebitMargin[0]).toBeCloseTo(0.2); // pretax 200 + interest 0
    expect(conventions).toEqual(expect.arrayContaining(["ebitFromPretax", "rf", "beta", "costOfDebt", "nwcPct"]));
    expect(a.beta).toBe(1);
  });
  it("CAGR", () => {
    expect(cagr(100, 161.051, 5)).toBeCloseTo(0.1);
    expect(cagr(0, 5, 5)).toBeNull();
  });
});
