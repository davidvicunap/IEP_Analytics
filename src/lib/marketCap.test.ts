import { describe, expect, it } from "vitest";
import { marketCapFrom, parseCoverShares } from "./marketCap";

const now = new Date("2026-11-24T00:00:00Z");

describe("cover-page share counts", () => {
  it("takes the latest filing and sums the classes it lists for that date", () => {
    const json = {
      units: {
        shares: [
          { end: "2026-07-17", val: 14_594_180_000, accn: "a-1", form: "10-Q", filed: "2026-07-31" },
          { end: "2026-10-23", val: 5_800_000_000, accn: "a-2", form: "10-K", filed: "2026-11-03" },
          { end: "2026-10-23", val: 860_000_000, accn: "a-2", form: "10-K", filed: "2026-11-03" },
          { end: "2026-10-23", val: 0, accn: "a-2", form: "10-K", filed: "2026-11-03" },
        ],
      },
    };
    expect(parseCoverShares(json)).toEqual({ value: 6_660_000_000, end: "2026-10-23", filed: "2026-11-03", accn: "a-2", form: "10-K" });
    expect(parseCoverShares({ units: {} })).toBeNull();
    expect(parseCoverShares(null)).toBeNull();
  });
});

describe("market value from SEC shares and a price", () => {
  const cover = { value: 14_532_182_000, end: "2026-10-23", filed: "2026-11-03", accn: "a-2", form: "10-K" };

  it("uses a recent cover count", () => {
    const m = marketCapFrom(250, "2026-11-23T21:00:00Z", cover, null, 2025, now)!;
    expect(m.value).toBeCloseTo(250 * 14_532_182_000);
    expect(m.sharesSource).toBe("cover");
  });

  it("falls back to diluted shares (net income ÷ EPS) when the cover count is stale or missing", () => {
    const old = { ...cover, filed: "2011-02-28" };
    const m = marketCapFrom(300, "t", old, { netIncome: 100e9, eps: 8 }, 2025, now)!;
    expect(m).toMatchObject({ shares: 12.5e9, sharesSource: "diluted", sharesAsOf: "FY2025" });
    // Losses: both negative still give a share count.
    expect(marketCapFrom(10, "t", null, { netIncome: -2e8, eps: -0.5 }, 2025, now)!.shares).toBe(4e8);
  });

  it("refuses a value it can't stand behind", () => {
    // Class A EPS against a class B price: price ÷ EPS far below any real multiple.
    expect(marketCapFrom(480, "t", null, { netIncome: 89e9, eps: 41_000 }, 2025, now)).toBeNull();
    expect(marketCapFrom(null, "t", cover, null, 2025, now)).toBeNull();
    expect(marketCapFrom(10, "t", null, { netIncome: 5e8 }, 2025, now)).toBeNull();
    expect(marketCapFrom(10, "t", null, { netIncome: 5e8, eps: -1 }, 2025, now)).toBeNull();
  });
});
