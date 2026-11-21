import { describe, expect, it } from "vitest";
import { applyInput, emptyNote, levelsBeforeSplit, splitAdjusted, type ResearchNote } from "./research";
import { detectSplit, splitsBetween, totalRatio } from "./splits";
import { listingOf } from "./listings";
import { book, positions, type Trade } from "./trades";

describe("detecting a split from two quotes", () => {
  const prev = { price: 1000, at: "2026-11-19T21:00:00Z" };
  it("a clean fraction on an ordinary day is a split; a crash of the same size is not", () => {
    expect(detectSplit(prev, { price: 101, changePct: 1.2, at: "2026-11-20T15:00:00Z" })).toBe(10);
    expect(detectSplit(prev, { price: 497, changePct: -0.6, at: "2026-11-20T15:00:00Z" })).toBe(2);
    expect(detectSplit({ price: 2, at: prev.at }, { price: 20.3, changePct: 1.5, at: "2026-11-20T15:00:00Z" })).toBe(0.1); // 1-for-10 reverse
    expect(detectSplit(prev, { price: 500, changePct: -50, at: "2026-11-20T15:00:00Z" })).toBeNull(); // a real halving
    expect(detectSplit(prev, { price: 700, changePct: -0.5, at: "2026-11-20T15:00:00Z" })).toBeNull(); // no clean factor
    expect(detectSplit(prev, { price: 101, changePct: null, at: "2026-11-20T15:00:00Z" })).toBeNull(); // can't tell
    expect(detectSplit(prev, { price: 101, changePct: 1, at: "2026-12-20T15:00:00Z" })).toBeNull(); // too far apart
  });

  it("finds the splits after a date and combines them", () => {
    const s = [
      { symbol: "A", ratio: 2, date: "2026-01-10" },
      { symbol: "A", ratio: 2, date: "2026-06-10" },
      { symbol: "B", ratio: 10, date: "2026-03-01" },
    ];
    expect(totalRatio(splitsBetween(s, "A", "2026-01-01"))).toBe(4);
    expect(splitsBetween(s, "A", "2026-01-10")).toHaveLength(1);
  });
});

describe("a split in the trade record", () => {
  const t = (side: "buy" | "sell", date: string, shares: number, price: number, extra: Partial<Trade> = {}): Trade => ({ id: `${side}${date}`, symbol: "NVDA", side, date, shares, price, fees: 0, stop: null, note: "", createdAt: `${date}T15:00:00Z`, ...extra });
  const split = [{ symbol: "NVDA", ratio: 10, date: "2026-06-10" }];

  it("the shares held before it multiply and their price divides; later trades are already in new prices", () => {
    const b = book([t("buy", "2026-01-05", 5, 1000, { stop: 900 }), t("sell", "2026-07-01", 20, 120)], split);
    expect(b.oversold).toEqual([]);
    expect(b.closed[0]).toMatchObject({ shares: 20, buyPrice: 100, sellPrice: 120, pnl: 400, r: 2 });
    expect(positions(b.open)).toMatchObject([{ shares: 30, avgPrice: 100, stop: 90 }]);
  });

  it("without the split the same record would sell shares never bought", () => {
    expect(book([t("buy", "2026-01-05", 5, 1000), t("sell", "2026-07-01", 20, 120)]).oversold).toHaveLength(1);
  });
});

describe("a split in the notebook", () => {
  const at = (d: string) => new Date(`${d}T15:00:00Z`);
  let n = 0;
  const id = () => `id${++n}`;
  const note: ResearchNote = applyInput(emptyNote("NVDA"), "NVDA", { stop: 900, target: 1300, fairValue: 1200, entry: 1000, checks: [{ type: "price", op: "above", value: 1250 }], price: 1000, baseUpdatedAt: null }, at("2026-01-05"), id);

  it("restates levels, price conditions and the earlier history once, and logs it", () => {
    const after = applyInput(note, "NVDA", { splitAdjust: { ratio: 10, date: "2026-06-10" }, baseUpdatedAt: null }, at("2026-06-11"), id);
    expect(after).toMatchObject({ stop: 90, target: 130, fairValue: 120, entry: 100 });
    expect(after.checks[0]).toMatchObject({ value: 125 });
    expect(after.opened?.price).toBe(100);
    expect(after.log[0]).toMatchObject({ kind: "split", ratio: 10, date: "2026-06-10" });
    expect(after.log.find((e) => e.kind === "fairValue")).toMatchObject({ value: 120, price: 100 });
    // No new fair-value entry: the value didn't change, only its units.
    expect(after.log.filter((e) => e.kind === "fairValue")).toHaveLength(1);
    // The same split again changes nothing.
    expect(splitAdjusted(after, { ratio: 10, date: "2026-06-10" }, "x", id)).toBe(after);
  });

  it("tells pre-split levels from levels already in new prices", () => {
    expect(levelsBeforeSplit(note, 100, 10)).toBe(true); // stop 900 with the price at 100
    expect(levelsBeforeSplit({ stop: 90, target: 130, fairValue: null, entry: null }, 100, 10)).toBe(false);
    expect(levelsBeforeSplit({ stop: null, target: null, fairValue: null, entry: null }, 100, 10)).toBeNull();
    expect(levelsBeforeSplit(note, null, 10)).toBeNull();
  });
});

describe("listings from the SEC list", () => {
  const rows = [
    { symbol: "FB", cik: 1326801, active: false, rank: 7 },
    { symbol: "META", cik: 1326801, active: true, rank: 7 },
    { symbol: "OLD", cik: 99, active: false, rank: null },
    { symbol: "AAPL", cik: 320193, active: true, rank: 1 },
  ];
  it("active, renamed to the company's current ticker, delisted, or unknown", () => {
    expect(listingOf("AAPL", rows)).toEqual({ status: "active" });
    expect(listingOf("FB", rows)).toEqual({ status: "renamed", to: "META" });
    expect(listingOf("OLD", rows)).toEqual({ status: "delisted" });
    expect(listingOf("ZZZ", rows)).toEqual({ status: "unknown" });
  });
});
