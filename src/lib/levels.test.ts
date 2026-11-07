import { describe, expect, it } from "vitest";
import { atr, keyLevels, type Bar } from "./levels";

/** Daily bars from a list of closes, with a 1 % intraday range. */
const bars = (closes: number[]): Bar[] =>
  closes.map((c, i) => ({ time: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10), close: c, high: c * 1.005, low: c * 0.995 }));

// A stock bouncing between ~100 (floor) and ~120 (ceiling) four times, then trading at 110.
function range(): number[] {
  const out: number[] = [];
  for (let cycle = 0; cycle < 4; cycle++) {
    for (let i = 0; i <= 20; i++) out.push(100 + i); // up to 120
    for (let i = 19; i >= 1; i--) out.push(100 + i); // back down near 100
  }
  for (let i = 0; i <= 10; i++) out.push(100 + i); // ends at 110
  return out;
}

describe("keyLevels", () => {
  const k = keyLevels(bars(range()))!;
  it("finds the floor as support and the ceiling as resistance, with their touches", () => {
    expect(k.close).toBe(110);
    expect(k.supports[0].price).toBeCloseTo(99.5, 1); // swing lows use the day's low
    expect(k.supports[0].touches).toBe(4);
    expect(k.supports[0].distance).toBeCloseTo(99.5 / 110 - 1, 3);
    expect(k.resistances[0].price).toBeCloseTo(120.6, 1);
    expect(k.resistances[0].touches).toBe(4);
  });
  it("reports the 52-week range and the averages it has enough history for", () => {
    expect(k.references.map((r) => r.key)).toEqual(["high52", "low52", "sma50"]); // 171 sessions: no 200-day average
    expect(k.references[0].price).toBeCloseTo(120 * 1.005);
  });
  it("needs enough history", () => {
    expect(keyLevels(bars([1, 2, 3]))).toBeNull();
  });
  it("ATR averages the true range", () => {
    const b = bars(Array.from({ length: 20 }, () => 100));
    expect(atr(b)).toBeCloseTo(1); // high − low = 1 % of 100
  });
});
