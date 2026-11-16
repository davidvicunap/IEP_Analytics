import { describe, expect, it } from "vitest";
import type { HistoryAnalysis } from "./valuation";
import { buildVerdict, tercile, valuationKey, type VerdictInputs } from "./verdict";

const row = (key: string, value: number | null, percentile: number | null, extra: Record<string, unknown> = {}) => ({
  key: key as never,
  applicable: true,
  value,
  note: null,
  sector: percentile === null ? null : { percentile, median: 0.1, n: 40 },
  ...extra,
});
const analysis = (verdict: HistoryAnalysis["verdict"]): HistoryAnalysis => ({
  key: "pe", current: 35, n: 60, from: "2021-11-30", mean: 28, median: 27, sd: 4, z: 1.75, percentile: 90, min: 20, max: 38, priceAtMedian: 180, verdict,
});

describe("at a glance", () => {
  it("splits the industry in thirds, flipping for 'lower is better'", () => {
    expect(tercile(80, "higher")).toBe("good");
    expect(tercile(50, "higher")).toBe("mid");
    expect(tercile(20, "higher")).toBe("weak");
    expect(tercile(20, "lower")).toBe("good"); // little debt
    expect(tercile(90, "lower")).toBe("weak");
  });

  it("builds the five lines from SEC figures and the company's own valuation history", () => {
    const inputs: VerdictInputs = {
      quality: { passed: 7, failed: 1, level: "high", revenueCagr5: 0.08 },
      ratios: { businessType: "general", rows: [row("revenueGrowth", 0.02, 30), row("roic", 0.4, 95), row("roe", 1.5, 99), row("debtToEquity", 1.8, 75)] },
      valuation: analysis("expensive"),
    };
    const v = buildVerdict(inputs);
    expect(v.missing).toEqual([]);
    expect(v.points.map((p) => [p.key, p.level, p.metric ?? null])).toEqual([
      ["quality", "good", null],
      ["growth", "weak", "revenueGrowth"],
      ["profitability", "good", "roic"], // ROIC, not ROE, for a general company
      ["debt", "weak", "debtToEquity"],
      ["valuation", "weak", "pe"],
    ]);
    expect(v.points[0]).toMatchObject({ passed: 7, judged: 8 });
    expect(v.points[1]).toMatchObject({ value: 0.02, compare: 0.1, peers: 40, cagr5: 0.08 });
    expect(v.points[4]).toMatchObject({ value: 35, compare: 28 });
  });

  it("uses the financial-company measures for banks", () => {
    const v = buildVerdict({
      quality: null,
      ratios: { businessType: "bank", rows: [row("epsGrowth", 0.1, 70), row("roe", 0.14, 60), row("equityToAssets", 0.09, 80)] },
      valuation: null,
    });
    expect(v.points.map((p) => [p.key, p.metric, p.level])).toEqual([
      ["growth", "epsGrowth", "good"],
      ["profitability", "roe", "mid"],
      ["debt", "equityToAssets", "good"],
    ]);
    expect(v.missing).toEqual(["quality", "valuation"]);
  });

  it("leaves out what it can't judge instead of guessing", () => {
    const v = buildVerdict({
      quality: { passed: 2, failed: 1, level: "na", revenueCagr5: null }, // fewer than 4 tests judged
      ratios: { businessType: "general", rows: [row("revenueGrowth", 0.3, null), row("roic", null, 50)] }, // no industry, no value
      valuation: null,
    });
    expect(v.points).toEqual([]);
    expect(v.missing).toEqual(["quality", "growth", "profitability", "debt", "valuation"]);
  });

  it("says so when equity is negative instead of comparing debt to it", () => {
    const v = buildVerdict({ quality: null, ratios: { businessType: "general", rows: [row("debtToEquity", null, null, { note: "negativeEquity" })] }, valuation: null });
    expect(v.points).toEqual([{ key: "debt", level: "weak", metric: "debtToEquity", note: "negativeEquity" }]);
  });

  it("values on P/E with profits, else sales; financials on P/E or book", () => {
    expect(valuationKey("general", (k) => k === "pe" || k === "ps")).toBe("pe");
    expect(valuationKey("general", (k) => k === "ps")).toBe("ps");
    expect(valuationKey("bank", (k) => k === "pb")).toBe("pb");
    expect(valuationKey("reit", () => false)).toBeNull();
  });
});
