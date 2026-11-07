import { describe, expect, it } from "vitest";
import { bollinger, ema, last, macd, rsi, sma } from "./indicators";
import { scoreMetric, summarize, technicalSignals, revenueGrowth } from "./scoring";
import type { Candle } from "./types";

describe("indicators", () => {
  it("sma", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("ema seeds with sma and smooths", () => {
    const e = ema([1, 2, 3, 4, 5], 3);
    expect(e[2]).toBe(2);
    expect(e[3]).toBeCloseTo(3);
    expect(e[4]).toBeCloseTo(4);
  });

  it("rsi is 100 for a monotonic rise and ~0 for a fall", () => {
    const up = Array.from({ length: 30 }, (_, i) => i + 1);
    expect(last(rsi(up))).toBe(100);
    const down = up.slice().reverse();
    expect(last(rsi(down))).toBeCloseTo(0);
  });

  it("rsi matches a known reference value", () => {
    // Classic Wilder example data (closes), RSI(14) on day 15 ≈ 70.5 (reference table rounds intermediates)
    const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    expect(rsi(closes)[14]!).toBeCloseTo(70.5, 0);
  });

  it("macd histogram is positive in an accelerating uptrend", () => {
    const v = Array.from({ length: 60 }, (_, i) => 100 + i * i * 0.05);
    const m = macd(v);
    expect(last(m.hist)!).toBeGreaterThan(0);
    expect(m.line[24]).toBeNull();
    expect(m.line[25]).not.toBeNull();
  });

  it("bollinger bands collapse on a flat series", () => {
    const b = bollinger(new Array(25).fill(10));
    expect(last(b.upper)).toBe(10);
    expect(last(b.lower)).toBe(10);
  });
});

describe("scoring", () => {
  it("rates P/E", () => {
    expect(scoreMetric("pe", 10).level).toBe("good");
    expect(scoreMetric("pe", 20).level).toBe("ok");
    expect(scoreMetric("pe", 45).level).toBe("bad");
    expect(scoreMetric("pe", -5).level).toBe("bad");
  });

  it("rates margins and debt", () => {
    expect(scoreMetric("netMargin", 0.25).level).toBe("good");
    expect(scoreMetric("netMargin", 0.02).level).toBe("bad");
    expect(scoreMetric("debtToEquity", 0.5).level).toBe("good");
    expect(scoreMetric("debtToEquity", 3).level).toBe("bad");
    expect(scoreMetric("dividendYield", 0).level).toBe("neutral");
  });

  it("computes revenue growth", () => {
    expect(revenueGrowth([{ year: "1", revenue: 100, netIncome: 1 }, { year: "2", revenue: 120, netIncome: 1 }])).toBeCloseTo(0.2);
    expect(revenueGrowth([])).toBeUndefined();
  });

  it("produces technical signals and a summary", () => {
    const hist: Candle[] = Array.from({ length: 260 }, (_, i) => {
      const c = 50 + i * 0.5;
      return { time: `d${i}`, open: c, high: c, low: c, close: c, volume: 1 };
    });
    const sig = technicalSignals(hist);
    expect(sig.map((s) => s.key)).toEqual(expect.arrayContaining(["rsiOverbought", "aboveSma200", "sma50Above200"]));
    const sum = summarize([scoreMetric("pe", 12), scoreMetric("debtToEquity", 3)], sig);
    expect(sum.map((s) => s.key)).toEqual(["valCheap", "debtHigh", "trendUp"]);
  });
});

describe("moving-average crosses", () => {
  const day = (i: number) => new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
  const candles = (values: number[]): Candle[] =>
    values.map((c, i) => ({ time: day(i), open: c, high: c, low: c, close: c, volume: 1 }));
  /** Falls linearly from `start` to `low` over `down` sessions, then rises `slope` per session. */
  const vShape = (down: number, up: number, start: number, low: number, slope: number) => [
    ...Array.from({ length: down }, (_, i) => start - ((start - low) * i) / (down - 1)),
    ...Array.from({ length: up }, (_, i) => low + slope * (i + 1)),
  ];

  it("reports a golden cross as a dated event", () => {
    const h = candles(vShape(250, 40, 200, 100, 3));
    const sig = technicalSignals(h).find((s) => s.key === "goldenCross");
    expect(sig).toMatchObject({ level: "good", days: 6, date: h[283].time });
  });

  it("reports a death cross as a dated event", () => {
    const h = candles(vShape(250, 40, 200, 100, 3).map((x) => 400 - x));
    const sig = technicalSignals(h).find((s) => s.key === "deathCross");
    expect(sig).toMatchObject({ level: "bad", days: 6, date: h[283].time });
  });

  it("reports the trend state when the cross is older than the lookback window", () => {
    const keys = technicalSignals(candles(vShape(250, 70, 200, 100, 3))).map((s) => s.key);
    expect(keys).toContain("sma50Above200");
    expect(keys).not.toContain("goldenCross");
  });
});
