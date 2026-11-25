// The track record: buys and sells the user logs against their theses, matched first-in
// first-out into open positions and closed trades, and the scorecard that answers "is my
// method working?". Pure and tested; storage is tradeStore.ts, the API /api/trades. Long
// positions only (a sell closes shares bought before; there's no short selling here).
import { adjustPrice, type Split } from "./splits";

export type Side = "buy" | "sell";

export interface Trade {
  id: string;
  symbol: string;
  side: Side;
  date: string; // YYYY-MM-DD, the day it was done
  shares: number;
  price: number;
  fees: number;
  /** For a buy: the thesis stop when it was logged (what "1 R" of risk was). */
  stop: number | null;
  note: string;
  createdAt: string;
}

export type TradeInput = Omit<Trade, "id" | "symbol" | "createdAt">;

export const TRADE_LIMITS = { perOwner: 2000, note: 500, shares: 1e9, price: 1e7 } as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A trade from the network, or null. Dates from 1990 to tomorrow (time zones); up to 6 decimals of a share. */
export function parseTradeInput(raw: unknown, today: string): TradeInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.side !== "buy" && r.side !== "sell") return null;
  if (typeof r.date !== "string" || !DATE.test(r.date) || Number.isNaN(Date.parse(r.date))) return null;
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  if (r.date < "1990-01-01" || r.date > tomorrow) return null;
  const positive = (v: unknown, max: number) => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max;
  // A sell at $0 records a total loss (a delisting or a bankruptcy); a buy always has a price.
  const priceOk = positive(r.price, TRADE_LIMITS.price) || (r.side === "sell" && r.price === 0);
  if (!positive(r.shares, TRADE_LIMITS.shares) || !priceOk) return null;
  const fees = r.fees === undefined || r.fees === null ? 0 : r.fees;
  if (typeof fees !== "number" || !Number.isFinite(fees) || fees < 0 || fees > TRADE_LIMITS.price) return null;
  const stop = r.stop === undefined || r.stop === null ? null : r.stop;
  if (stop !== null && !positive(stop, TRADE_LIMITS.price)) return null;
  const note = r.note === undefined ? "" : r.note;
  if (typeof note !== "string" || note.length > TRADE_LIMITS.note) return null;
  return {
    side: r.side,
    date: r.date,
    shares: Math.round((r.shares as number) * 1e6) / 1e6,
    price: Math.round((r.price as number) * 1e4) / 1e4,
    fees: Math.round(fees * 100) / 100,
    stop: r.side === "buy" && typeof stop === "number" ? Math.round(stop * 1e4) / 1e4 : null,
    note: note.trim(),
  };
}

export interface Lot {
  symbol: string;
  date: string;
  shares: number;
  price: number;
  /** Buy fees still attached to these shares. */
  fees: number;
  stop: number | null;
}

export interface ClosedTrade {
  symbol: string;
  shares: number;
  buyDate: string;
  buyPrice: number;
  sellDate: string;
  sellPrice: number;
  stop: number | null;
  /** Profit or loss after both fees. */
  pnl: number;
  /** pnl ÷ what was paid (fees included). */
  ret: number;
  /** The result in units of the risk planned at the buy (price move ÷ distance to the stop); null without a stop below the buy. */
  r: number | null;
  days: number;
}

export interface Book {
  open: Lot[];
  closed: ClosedTrade[];
  /** Sells of shares that weren't bought before (by date): the record is inconsistent there. */
  oversold: { symbol: string; date: string; shares: number }[];
}

const EPS = 1e-9;
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const byTime = (a: Trade, b: Trade) => a.date.localeCompare(b.date) || (a.side === b.side ? a.createdAt.localeCompare(b.createdAt) : a.side === "buy" ? -1 : 1);

/**
 * Matches sells to earlier buys of the same stock, oldest first. Buys on the same day count before
 * sells. A split turns the shares held before it into `ratio` times as many at `1/ratio` the price
 * (stops too), on its date, before that day's trades (which are already at the new prices).
 */
export function book(trades: Trade[], splits: Split[] = []): Book {
  const open = new Map<string, Lot[]>();
  const closed: ClosedTrade[] = [];
  const oversold: Book["oversold"] = [];
  const held = new Set(trades.map((t) => t.symbol));
  const pending = splits.filter((x) => held.has(x.symbol)).sort((a, b) => a.date.localeCompare(b.date));
  const split = (until: string, inclusive: boolean) => {
    while (pending.length && (inclusive ? pending[0].date <= until : pending[0].date < until)) {
      const x = pending.shift()!;
      for (const lot of open.get(x.symbol) ?? []) {
        lot.shares = Math.round(lot.shares * x.ratio * 1e6) / 1e6;
        lot.price = adjustPrice(lot.price, x.ratio);
        if (lot.stop !== null) lot.stop = adjustPrice(lot.stop, x.ratio);
      }
    }
  };
  for (const t of [...trades].sort(byTime)) {
    split(t.date, true);
    const lots = open.get(t.symbol) ?? [];
    open.set(t.symbol, lots);
    if (t.side === "buy") {
      lots.push({ symbol: t.symbol, date: t.date, shares: t.shares, price: t.price, fees: t.fees, stop: t.stop });
      continue;
    }
    let left = t.shares;
    while (left > EPS && lots.length) {
      const lot = lots[0];
      const n = Math.min(left, lot.shares);
      const buyFees = lot.fees * (n / lot.shares);
      const sellFees = t.fees * (n / t.shares);
      const paid = n * lot.price + buyFees;
      const pnl = n * (t.price - lot.price) - buyFees - sellFees;
      closed.push({
        symbol: t.symbol,
        shares: n,
        buyDate: lot.date,
        buyPrice: lot.price,
        sellDate: t.date,
        sellPrice: t.price,
        stop: lot.stop,
        pnl,
        ret: paid > 0 ? pnl / paid : 0,
        r: lot.stop !== null && lot.stop < lot.price ? (t.price - lot.price) / (lot.price - lot.stop) : null,
        days: days(lot.date, t.date),
      });
      lot.fees -= buyFees;
      lot.shares -= n;
      left -= n;
      if (lot.shares <= EPS) lots.shift();
    }
    if (left > EPS) oversold.push({ symbol: t.symbol, date: t.date, shares: left });
  }
  split("9999-12-31", true);
  return { open: [...open.values()].flat(), closed, oversold };
}

export interface Position {
  symbol: string;
  shares: number;
  /** What the open shares cost, fees included. */
  cost: number;
  avgPrice: number;
  since: string;
  /** The stop of the newest open lot. */
  stop: number | null;
}

export function positions(open: Lot[]): Position[] {
  const by = new Map<string, Lot[]>();
  for (const l of open) by.set(l.symbol, [...(by.get(l.symbol) ?? []), l]);
  return [...by]
    .map(([symbol, lots]) => {
      const shares = lots.reduce((s, l) => s + l.shares, 0);
      const cost = lots.reduce((s, l) => s + l.shares * l.price + l.fees, 0);
      return { symbol, shares, cost, avgPrice: cost / shares, since: lots[0].date, stop: lots[lots.length - 1].stop };
    })
    .sort((a, b) => b.cost - a.cost);
}
