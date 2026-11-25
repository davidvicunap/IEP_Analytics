import { describe, expect, it } from "vitest";
import { book, parseTradeInput, positions, type Trade } from "./trades";

let n = 0;
const t = (symbol: string, side: "buy" | "sell", date: string, shares: number, price: number, extra: Partial<Trade> = {}): Trade => ({
  id: `t${++n}`,
  symbol,
  side,
  date,
  shares,
  price,
  fees: 0,
  stop: null,
  note: "",
  createdAt: `2026-01-01T00:00:${String(n).padStart(2, "0")}Z`,
  ...extra,
});

describe("validating a trade", () => {
  it("accepts a buy or sell with a date up to tomorrow, positive shares and price", () => {
    expect(parseTradeInput({ side: "buy", date: "2026-11-20", shares: 10.1234567, price: 230.12345, stop: 210, note: " first " }, "2026-11-21")).toEqual({
      side: "buy",
      date: "2026-11-20",
      shares: 10.123457,
      price: 230.1235,
      fees: 0,
      stop: 210,
      note: "first",
    });
    // A sell at $0 records a total loss; a buy at $0 isn't a buy.
    expect(parseTradeInput({ side: "sell", date: "2026-11-20", shares: 5, price: 0 }, "2026-11-21")?.price).toBe(0);
    expect(parseTradeInput({ side: "buy", date: "2026-11-20", shares: 5, price: 0 }, "2026-11-21")).toBeNull();
    // A sell carries no stop.
    expect(parseTradeInput({ side: "sell", date: "2026-11-21", shares: 1, price: 2, stop: 1 }, "2026-11-21")?.stop).toBeNull();
    for (const bad of [{}, { side: "short", date: "2026-11-20", shares: 1, price: 1 }, { side: "buy", date: "2026-11-30", shares: 1, price: 1 }, { side: "buy", date: "1980-01-01", shares: 1, price: 1 }, { side: "buy", date: "2026-11-20", shares: 0, price: 1 }, { side: "buy", date: "2026-11-20", shares: 1, price: -1 }, { side: "buy", date: "2026-11-20", shares: 1, price: 1, fees: -2 }, { side: "buy", date: "2026-11-20", shares: 1, price: 1, note: "x".repeat(501) }]) {
      expect(parseTradeInput(bad, "2026-11-21")).toBeNull();
    }
  });
});

describe("matching sells to buys (first in, first out)", () => {
  it("closes the oldest shares first, splitting a lot and its fees", () => {
    const trades = [t("AAPL", "buy", "2026-01-05", 10, 100, { fees: 10, stop: 90 }), t("AAPL", "buy", "2026-02-05", 10, 120), t("AAPL", "sell", "2026-03-05", 15, 130, { fees: 3 })];
    const b = book(trades);
    expect(b.oversold).toEqual([]);
    expect(b.closed).toHaveLength(2);
    const [first, second] = b.closed;
    // 10 from the first lot: (130 − 100) × 10 − 10 buy fees − 2 of the 3 sell fees.
    expect(first).toMatchObject({ shares: 10, buyPrice: 100, sellPrice: 130, pnl: 288, r: 3, days: 59 });
    expect(first.ret).toBeCloseTo(288 / 1010);
    // 5 from the second: (130 − 120) × 5 − 1 sell fee; no stop, no R.
    expect(second).toMatchObject({ shares: 5, buyPrice: 120, pnl: 49, r: null });
    expect(positions(b.open)).toEqual([{ symbol: "AAPL", shares: 5, cost: 600, avgPrice: 120, since: "2026-02-05", stop: null }]);
  });

  it("flags a sell of shares that weren't bought before", () => {
    const b = book([t("KO", "sell", "2026-01-02", 5, 60), t("KO", "buy", "2026-01-03", 5, 58)]);
    expect(b.oversold).toEqual([{ symbol: "KO", date: "2026-01-02", shares: 5 }]);
    expect(positions(b.open)).toMatchObject([{ symbol: "KO", shares: 5 }]);
  });

  it("counts a same-day buy before the sell", () => {
    const b = book([t("X", "sell", "2026-01-02", 1, 11), t("X", "buy", "2026-01-02", 1, 10)]);
    expect(b.oversold).toEqual([]);
    expect(b.closed[0].pnl).toBe(1);
  });
});
