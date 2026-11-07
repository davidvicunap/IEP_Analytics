import { describe, expect, it } from "vitest";
import { parseShares, type SharesHistory, type StatementSet } from "./secFinancials";
import {
  adjustedShares, historyStats, multipleHistory, multipleNote, multiplesFor, sharesAt, sharesConsistency, ttmAt, ttmSeries,
} from "./valuation";

const cell = (value: number | null, extra: object = {}) => ({ value, ...extra });
const Q = (label: string, end: string, filed: string) => ({ label, end, filed });

// Five calendar quarters; the fifth makes a second TTM window.
const quarterly: StatementSet = {
  periods: [
    Q("Q1 FY2025", "2025-03-31", "2025-05-01"),
    Q("Q2 FY2025", "2025-06-30", "2025-08-01"),
    Q("Q3 FY2025", "2025-09-30", "2025-11-01"),
    Q("Q4 FY2025", "2025-12-31", "2026-02-15"),
    Q("Q1 FY2026", "2026-03-31", "2026-05-01"),
  ],
  lines: {
    revenue: [cell(100), cell(110), cell(120), cell(130), cell(140)],
    netIncome: [cell(10), cell(11), cell(12), cell(-3), cell(14)],
    freeCashFlow: [cell(5), cell(6), cell(null), cell(8), cell(9)],
    equity: [cell(500), cell(510), cell(520), cell(530), cell(540)],
  },
};

describe("TTM", () => {
  const ttm = ttmSeries(quarterly);
  it("sums four consecutive quarters and takes equity at the last one", () => {
    expect(ttm.map((t) => t.label)).toEqual(["Q4 FY2025", "Q1 FY2026"]);
    expect(ttm[0]).toMatchObject({ revenue: 460, netIncome: 30, equity: 530, filed: "2026-02-15" });
    expect(ttm[1]).toMatchObject({ revenue: 500, netIncome: 34, equity: 540 });
  });
  it("leaves a sum out when any quarter is missing", () => {
    expect(ttm[0].fcf).toBeUndefined(); // Q3 FCF missing
    expect(ttm[1].fcf).toBeUndefined();
  });
  it("uses only figures already public on the date (no look-ahead)", () => {
    expect(ttmAt(ttm, "2026-02-14")).toBeUndefined();
    expect(ttmAt(ttm, "2026-03-31")?.label).toBe("Q4 FY2025");
    expect(ttmAt(ttm, "2026-05-01")?.label).toBe("Q1 FY2026");
  });
  it("skips windows with a gap between quarters", () => {
    const gap: StatementSet = { ...quarterly, periods: quarterly.periods.map((p, i) => (i === 2 ? { ...p, end: "2025-10-31" } : p)) };
    expect(ttmSeries(gap)).toHaveLength(0);
  });
});

describe("shares and splits", () => {
  const dei = {
    EntityCommonStockSharesOutstanding: {
      units: {
        shares: [
          { end: "2024-01-20", val: 1000, accn: "a", form: "10-Q", filed: "2024-02-01" },
          { end: "2024-04-20", val: 990, accn: "b", form: "10-Q", filed: "2024-05-01" },
          { end: "2024-07-20", val: 3960, accn: "c", form: "10-Q", filed: "2024-08-01" }, // 4-for-1 split
          { end: "2024-07-20", val: 3961, accn: "d", form: "10-Q/A", filed: "2024-08-15" }, // amendment wins
          { end: "2024-10-20", val: 3900, accn: "e", form: "10-K", filed: "2024-11-01" },
        ],
      },
    },
  };
  const sh = parseShares(dei);

  it("detects the split and restates earlier counts to today's basis", () => {
    expect(sh.splits).toEqual([{ after: "2024-04-20", before: "2024-07-20", ratio: 4 }]);
    expect(adjustedShares(sh).map((p) => p.value)).toEqual([4000, 3960, 3961, 3900]);
    expect(sharesAt(adjustedShares(sh), "2024-05-10")).toBe(3960);
    expect(sharesAt(adjustedShares(sh), "2023-12-31")).toBeUndefined();
  });

  it("starts the history after a jump that isn't a clean split", () => {
    const merger = parseShares({
      EntityCommonStockSharesOutstanding: {
        units: { shares: [{ end: "2024-01-20", val: 100, accn: "a", form: "10-Q", filed: "2024-02-01" }, { end: "2024-04-20", val: 263, accn: "b", form: "10-Q", filed: "2024-05-01" }] },
      },
    });
    expect(merger.splits).toEqual([]);
    expect(merger.reliableFrom).toBe("2024-04-20");
    expect(adjustedShares(merger)).toEqual([{ end: "2024-04-20", value: 263 }]);
  });

  it("checks the SEC count against the one implied by the quote", () => {
    expect(sharesConsistency(sh, 3900 * 50, 50)).toBeCloseTo(1);
    expect(sharesConsistency(sh, 0, 50)).toBeNull();
  });
});

describe("multiples", () => {
  const t = { end: "2025-12-31", filed: "2026-02-15", label: "Q4 FY2025", revenue: 460, netIncome: 30, fcf: 20, equity: 530 };
  it("P/E, P/S, P/B and FCF yield from market cap and TTM", () => {
    const m = multiplesFor(1200, t);
    expect(m.pe).toBeCloseTo(40);
    expect(m.ps).toBeCloseTo(1200 / 460);
    expect(m.pb).toBeCloseTo(1200 / 530);
    expect(m.fcfYield).toBeCloseTo(20 / 1200);
  });
  it("leaves out P/E on losses and P/B on negative equity, with a note", () => {
    const bad = { ...t, netIncome: -5, equity: -1, fcf: -10 };
    expect(multiplesFor(1200, bad)).toMatchObject({ pe: null, pb: null });
    expect(multiplesFor(1200, bad).fcfYield).toBeCloseTo(-10 / 1200);
    expect(multipleNote("pe", bad)).toBe("loss");
    expect(multipleNote("pb", bad)).toBe("negativeEquity");
    expect(multipleNote("fcfYield", bad)).toBe("negativeFcf");
    expect(multipleNote("ps", { ...t, revenueAmbiguous: true })).toBe("revenueAmbiguous");
  });
});

describe("multiple history", () => {
  // AAPL-like check: on 2023-12-29 the close was $192.53, 15,552,752,000 shares (cover page
  // as of 2023-10-20) and FY2023 net income $96,995M (10-K filed 2023-11-03) → P/E ≈ 30.9.
  const shares: SharesHistory = { points: [{ end: "2023-10-20", value: 15_552_752_000, filed: "2023-11-03" }], splits: [], reliableFrom: null };
  const ttm = [{ end: "2023-09-30", filed: "2023-11-03", label: "Q4 FY2023", netIncome: 96_995_000_000, revenue: 383_285_000_000, equity: 62_146_000_000 }];

  it("samples the last close of each month and uses the shares and TTM known then", () => {
    const h = multipleHistory(
      [
        { time: "2023-10-19", close: 175.46 }, // before the first share count
        { time: "2023-12-28", close: 193.58 },
        { time: "2023-12-29", close: 192.53 },
      ],
      shares,
      ttm,
    );
    expect(h).toHaveLength(1);
    expect(h[0].date).toBe("2023-12-29");
    expect(h[0].values.pe).toBeCloseTo(30.87, 2);
  });

  it("needs 24 months to compare with history", () => {
    const pts = Array.from({ length: 30 }, (_, i) => ({ date: `m${i}`, marketCap: 1, values: { pe: 10 + i, ps: null, pb: null, fcfYield: null } }));
    expect(historyStats(pts, "pe", 39)).toMatchObject({ n: 30, percentile: 98, median: 24.5, min: 10, max: 39 });
    expect(historyStats(pts, "ps", 1)).toBeNull();
    expect(historyStats(pts.slice(0, 20), "pe", 15)).toBeNull();
  });
});
