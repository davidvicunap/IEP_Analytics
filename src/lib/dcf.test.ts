import { describe, expect, it } from "vitest";
import reference from "./__fixtures__/dcf-reference.json";
import { cagr, dcf, dcfIssue, defaultScenarios, growthPath, impliedGrowth } from "./dcf";

const TOLERANCE = 0.005; // acceptance criterion: within 0.5 % of the reference sheet

describe("DCF vs the independent reference (5 tickers, real inputs)", () => {
  for (const c of reference.cases) {
    it(`${c.symbol}: scenario values and implied growth match within 0.5 %`, () => {
      const base = { fcf0: c.fcf0, r: reference.r, gT: reference.gT };
      for (const name of ["bear", "base", "bull"] as const) {
        const v = dcf({ ...base, g1: c.scenarios[name] }).value;
        expect(Math.abs(v / c.expected[name] - 1)).toBeLessThan(TOLERANCE);
      }
      const { g } = impliedGrowth(base, c.marketCap);
      expect(Math.abs(g! / c.expected.impliedGrowth - 1)).toBeLessThan(TOLERANCE);
      // and the implied growth really reproduces the market value
      expect(Math.abs(dcf({ ...base, g1: g! }).value / c.marketCap - 1)).toBeLessThan(1e-9);
    });
  }
});

describe("model details", () => {
  it("grows at g1 for 5 years, then fades linearly to terminal growth", () => {
    const path = growthPath(0.2, 0.02);
    expect(path.slice(0, 5)).toEqual([0.2, 0.2, 0.2, 0.2, 0.2]);
    expect(path[5]).toBeCloseTo(0.164);
    expect(path[9]).toBeCloseTo(0.02);
  });

  it("matches a hand-computed case with flat growth", () => {
    // g1 = gT = 0: ten flows of 100 at 10 % plus a perpetuity of 100 → exactly 100 / 0.1 = 1,000.
    const r = dcf({ fcf0: 100, r: 0.1, gT: 0, g1: 0 });
    expect(r.value).toBeCloseTo(1000, 6);
    expect(r.pvFlows).toBeCloseTo(614.457, 3);
    expect(r.pvTerminal).toBeCloseTo(385.543, 3);
  });

  it("flags inputs where a DCF on free cash flow isn't meaningful", () => {
    expect(dcfIssue({ fcf0: -46.9e9, r: 0.093, gT: 0.025 })).toBe("negativeFcf"); // e.g. heavy capex years
    expect(dcfIssue({ fcf0: 10, r: 0.02, gT: 0.025 })).toBe("rateBelowGrowth");
    expect(dcfIssue({ fcf0: 10, r: 0, gT: 0 })).toBe("badRate");
    expect(dcfIssue({ fcf0: 10, r: 0.09, gT: 0.025 })).toBeNull();
  });

  it("reports when the price needs more than 100 % or less than −50 % growth", () => {
    expect(impliedGrowth({ fcf0: 1, r: 0.09, gT: 0.025 }, 1e9)).toEqual({ g: null, bound: "above" });
    expect(impliedGrowth({ fcf0: 1e9, r: 0.09, gT: 0.025 }, 1)).toEqual({ g: null, bound: "below" });
  });

  it("defaults scenarios from revenue CAGR, clamped and rounded", () => {
    expect(cagr(100, 161.051, 5)).toBeCloseTo(0.1);
    expect(cagr(-1, 5, 5)).toBeNull();
    expect(defaultScenarios(0.0553)).toEqual({ bear: 0.005, base: 0.055, bull: 0.105 });
    expect(defaultScenarios(0.67).base).toBe(0.2);
    expect(defaultScenarios(-0.3)).toEqual({ bear: -0.1, base: -0.05, bull: 0 });
    expect(defaultScenarios(null).base).toBe(0.03);
  });
});
