import { describe, expect, it } from "vitest";
import type { KeyLevels } from "./levels";
import { addLines, parseRisk, positionSize, reasonsFrom, removeLines, reviewOptions, stopOptions, targetOptions } from "./planBuilder";
import type { VerdictPoint } from "./verdict";

const levels: KeyLevels = {
  close: 230,
  date: "2026-11-20",
  atr: 4,
  tolerance: 3.45,
  supports: [
    { price: 200, low: 198, high: 202, touches: 3, lastDate: "2026-08-01", distance: -0.13 },
    { price: 150, low: 148, high: 152, touches: 2, lastDate: "2025-04-01", distance: -0.35 },
  ],
  resistances: [
    { price: 250, low: 248, high: 252, touches: 2, lastDate: "2026-06-01", distance: 0.087 },
    { price: 270, low: 268, high: 272, touches: 2, lastDate: "2026-01-10", distance: 0.17 },
  ],
  references: [
    { key: "high52", price: 272.88, distance: 0.19, date: "2026-01-12" },
    { key: "low52", price: 190, distance: -0.17, date: "2026-04-08" },
  ],
};

describe("suggested stops", () => {
  it("expecting a rise: under the entry, nearest first, each with its reason", () => {
    const s = stopOptions(levels, 230, "up");
    // 2 × ATR = 222; just under the support zone (its low $198 less max(¼ ATR, 0.5 % of entry) = $1.15); just under the 52-week low.
    expect(s.map((o) => o.level)).toEqual([222, 196.85, 188.85]);
    expect(s[0].basis).toEqual({ kind: "atr", atr: 4, multiple: 2 });
    expect(s[1].basis).toEqual({ kind: "zone", side: "support", price: 200, touches: 3 });
    expect(s[2].basis).toEqual({ kind: "low52", price: 190 });
    expect(s[0].pct).toBeCloseTo(222 / 230 - 1);
  });

  it("expecting a fall: above the entry", () => {
    const s = stopOptions(levels, 230, "down");
    expect(s.map((o) => o.level)).toEqual([238, 253.15, 274.03]);
    expect(s[1].basis).toMatchObject({ kind: "zone", side: "resistance", price: 250 });
  });

  it("ignores zones on the wrong side of an edited entry, and suggests nothing without levels", () => {
    // Entry below the $200 zone: that zone is no longer under it.
    expect(stopOptions(levels, 199, "up").map((o) => o.basis.kind)).toEqual(["atr", "low52", "zone"]);
    expect(stopOptions(null, 230, "up")).toEqual([]);
    expect(stopOptions(levels, 0, "up")).toEqual([]);
  });
});

describe("suggested targets", () => {
  it("in front of the next zones, the 52-week high and your fair value, at most three", () => {
    const t = targetOptions(levels, 230, "up", 260);
    expect(t.map((o) => o.level)).toEqual([248, 260, 268]);
    expect(t[1].basis).toEqual({ kind: "fairValue", price: 260 });
  });

  it("leaves out a fair value on the wrong side and works without levels", () => {
    expect(targetOptions(levels, 230, "up", 210).some((o) => o.basis.kind === "fairValue")).toBe(false);
    expect(targetOptions(null, 230, "up", 260)).toEqual([{ level: 260, basis: { kind: "fairValue", price: 260 }, pct: 260 / 230 - 1 }]);
    expect(targetOptions(levels, 230, "down", null).map((o) => o.level)).toEqual([202, 190, 152]);
  });
});

describe("review dates", () => {
  it("the market day before the next results, then 3 and 6 months out (weekends moved)", () => {
    expect(reviewOptions("2026-11-21", "2027-01-29")).toEqual([
      { kind: "results", date: "2027-01-28", results: "2027-01-29" },
      { kind: "months", months: 3, date: "2027-02-22" },
      { kind: "months", months: 6, date: "2027-05-24" },
    ]);
    // Results on a Monday: review the Friday before.
    expect(reviewOptions("2026-11-21", "2027-02-01")[0]).toEqual({ kind: "results", date: "2027-01-29", results: "2027-02-01" });
  });

  it("skips results that are too close or too far, and unknown ones", () => {
    expect(reviewOptions("2026-11-21", "2026-11-23").map((o) => o.kind)).toEqual(["months", "months"]);
    expect(reviewOptions("2026-11-21", "2027-12-01").map((o) => o.kind)).toEqual(["months", "months"]);
    expect(reviewOptions("2026-11-21", null)).toHaveLength(2);
  });
});

describe("position size", () => {
  it("shares = what you accept to lose ÷ what one share loses at the stop", () => {
    const s = positionSize({ account: 10_000, pct: 0.01, entry: 230, stop: 222, target: 248, direction: "up" })!;
    expect(s).toMatchObject({ perShare: 8, budget: 100, shares: 12, capped: false, cost: 2760, risk: 96, reward: 216, ratio: 2.25 });
    expect(s.weight).toBeCloseTo(0.276);
  });

  it("in fractions when the broker sells them: a small account still gets a position", () => {
    // $500 at 1 % risk, a $230 share with an $8 stop: $5 ÷ $8 = 0.625 shares (whole shares: none).
    expect(positionSize({ account: 500, pct: 0.01, entry: 230, stop: 222, target: null, direction: "up" })!.shares).toBe(0);
    expect(positionSize({ account: 500, pct: 0.01, entry: 230, stop: 222, target: null, direction: "up", fractions: true })).toMatchObject({ shares: 0.625, risk: 5, cost: 143.75 });
  });

  it("never more than the account can pay for", () => {
    const s = positionSize({ account: 1000, pct: 0.02, entry: 230, stop: 229, target: null, direction: "up" })!;
    expect(s).toMatchObject({ shares: 4, capped: true, risk: 4, reward: null, ratio: null });
  });

  it("works for an expected fall, and says nothing when it can't be sized", () => {
    expect(positionSize({ account: 10_000, pct: 0.01, entry: 230, stop: 238, target: 202, direction: "down" })).toMatchObject({ perShare: 8, shares: 12, reward: 336, ratio: 3.5 });
    expect(positionSize({ account: null, pct: 0.01, entry: 230, stop: 222, target: null, direction: "up" })).toBeNull();
    expect(positionSize({ account: 10_000, pct: 0.01, entry: 230, stop: 240, target: null, direction: "up" })).toBeNull(); // stop on the winning side
    expect(positionSize({ account: 10_000, pct: 0.01, entry: 230, stop: null, target: null, direction: "up" })).toBeNull();
  });

  it("keeps only sensible saved settings", () => {
    expect(parseRisk({ account: 25_000, pct: 0.02, currency: "MXN", fractions: false })).toEqual({ account: 25_000, pct: 0.02, currency: "MXN", fractions: false });
    expect(parseRisk({ account: -5, pct: 0.5, currency: "XYZ" })).toEqual({ account: null, pct: 0.01, currency: "USD", fractions: true });
    expect(parseRisk("x")).toEqual({ account: null, pct: 0.01, currency: "USD", fractions: true });
  });
});

describe("reasons", () => {
  const points: VerdictPoint[] = [
    { key: "quality", level: "good", passed: 9, judged: 10 },
    { key: "growth", level: "mid", metric: "revenueGrowth", value: 0.06, compare: 0.05 },
    { key: "valuation", level: "weak", metric: "pe", value: 34, compare: 27 },
  ];

  it("good lines speak for a rise and weak ones against it; the other way round for a fall", () => {
    expect(reasonsFrom(points, "up")).toEqual({ for: [points[0]], against: [points[2]] });
    expect(reasonsFrom(points, "down")).toEqual({ for: [points[2]], against: [points[0]] });
  });

  it("adds each line once and takes it back out", () => {
    const text = addLines("Brand", ["High quality", "brand", "High quality"]);
    expect(text).toBe("Brand\nHigh quality");
    expect(removeLines(text, ["high quality"])).toBe("Brand");
    expect(addLines("", ["A"])).toBe("A");
  });
});
