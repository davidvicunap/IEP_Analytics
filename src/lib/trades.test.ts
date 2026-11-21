import { describe, expect, it } from "vitest";
import { PAST_STOP_R, book, closeOn, lastWeek, parseTradeInput, positions, scorecard, type Trade } from "./trades";

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

describe("the scorecard", () => {
  const spy = [
    { time: "2026-01-02", close: 500 },
    { time: "2026-03-02", close: 520 },
    { time: "2026-05-01", close: 510 },
  ];

  it("hit rate, average result, R, stops respected and the S&P 500 over the same dates", () => {
    const trades = [
      t("A", "buy", "2026-01-02", 10, 100, { stop: 90 }),
      t("A", "sell", "2026-03-02", 10, 120), // +20 %, +2 R
      t("B", "buy", "2026-03-02", 10, 50, { stop: 45 }),
      t("B", "sell", "2026-05-01", 10, 40), // −20 %, −2 R: held past the stop
      t("C", "buy", "2026-03-04", 1, 10),
      t("C", "sell", "2026-05-01", 1, 11), // +10 %, no stop
    ];
    const s = scorecard(book(trades).closed, spy);
    expect(s).toMatchObject({ closed: 3, wins: 2, withStop: 2, pastStop: 1 });
    expect(s.winRate).toBeCloseTo(2 / 3);
    expect(s.realized).toBeCloseTo(200 - 100 + 1);
    expect(s.avgReturn).toBeCloseTo((0.2 - 0.2 + 0.1) / 3);
    expect(s.avgR).toBeCloseTo(0);
    expect(-2).toBeLessThan(PAST_STOP_R);
    // SPY: +4 % (Jan→Mar), −1.92 % (Mar→May), and from the 4 March close on or before (520) → 510.
    expect(s.benchmark.covered).toBe(3);
    expect(s.benchmark.avgReturn).toBeCloseTo((0.04 + (510 / 520 - 1) * 2) / 3);
  });

  it("says nothing it can't know: no trades, no benchmark history", () => {
    const s = scorecard([], null);
    expect(s).toMatchObject({ closed: 0, winRate: null, avgReturn: null, avgR: null, avgDays: null, benchmark: { avgReturn: null, covered: 0 } });
    // A trade older than the benchmark's history isn't compared.
    const old = book([t("A", "buy", "2020-01-02", 1, 1), t("A", "sell", "2026-03-02", 1, 2)]).closed;
    expect(scorecard(old, spy).benchmark.covered).toBe(0);
  });

  it("finds the last close on or before a date", () => {
    expect(closeOn(spy, "2026-03-01")).toBe(500);
    expect(closeOn(spy, "2026-03-02")).toBe(520);
    expect(closeOn(spy, "2025-12-31")).toBeNull();
  });
});

describe("the last 7 days", () => {
  it("counts the trades logged and the positions closed", () => {
    const trades = [t("A", "buy", "2026-11-10", 1, 10), t("A", "sell", "2026-11-18", 1, 12), t("B", "buy", "2026-11-20", 1, 5)];
    const w = lastWeek(trades, book(trades).closed, "2026-11-21");
    expect(w).toMatchObject({ from: "2026-11-15", buys: 1, sells: 1, realized: 2 });
    expect(w.closed).toHaveLength(1);
  });
});
