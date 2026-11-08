import { describe, expect, it } from "vitest";
import { RULES, missingSummaryMetrics, scoreFundamentals, summarize, technicalSignals } from "./scoring";
import type { Candle } from "./types";

const candles = (n: number, f: (i: number) => number): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ time: new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10), open: f(i), high: f(i), low: f(i), close: f(i), volume: 1 }));

describe("summary evidence", () => {
  it("carries the number behind each sentence", () => {
    const scores = scoreFundamentals({ pe: 35, netMargin: 0.24 }, [
      { year: "2024", revenue: 100, netIncome: 10 },
      { year: "2025", revenue: 102, netIncome: 12 },
    ]);
    const points = summarize(scores, technicalSignals(candles(260, (i) => 100 + i)));
    expect(points.find((p) => p.key === "valExpensive")).toMatchObject({ metric: "pe", value: 35, level: "bad" });
    expect(points.find((p) => p.key === "growSlow")).toMatchObject({ metric: "revenueGrowth" });
    expect(points.find((p) => p.key === "trendUp")?.trend).toMatchObject({ close: 359 });
  });

  it("lists the metrics it couldn't judge instead of hiding them", () => {
    const scores = scoreFundamentals({ pe: 12 }, []);
    expect(missingSummaryMetrics(scores)).toEqual(["revenueGrowth", "netMargin", "debtToEquity"]);
  });

  it("exposes the fixed rules so the UI can label them as heuristics", () => {
    expect(RULES.pe).toMatchObject({ dir: "low", good: 15, bad: 30 });
  });
});
