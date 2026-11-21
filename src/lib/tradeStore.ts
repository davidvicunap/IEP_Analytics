// Where the track record is kept: Postgres, one row per buy or sell, per beta label. Demo mode
// without a database keeps trades in memory, like the research notebooks.
import { and, asc, eq } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { trades } from "@/db/schema";
import { isDemo } from "./data";
import type { Trade } from "./trades";

export interface TradeStore {
  list(owner: string): Promise<Trade[]>;
  add(owner: string, trade: Trade): Promise<void>;
  /** The removed trade, or null when this owner has none with that id. */
  remove(owner: string, id: string): Promise<Trade | null>;
  /** Everyone with at least one trade (the scheduled holding checks). */
  owners(): Promise<string[]>;
  /** Moves a stock's trades to its new ticker; how many moved. */
  rename(owner: string, from: string, to: string): Promise<number>;
}

type Row = typeof trades.$inferSelect;
const fromRow = (r: Row): Trade => ({
  id: r.id,
  symbol: r.symbol,
  side: r.side === "sell" ? "sell" : "buy",
  date: r.date,
  shares: r.shares,
  price: r.price,
  fees: r.fees,
  stop: r.stop,
  note: r.note,
  createdAt: r.createdAt.toISOString(),
});

export function postgresTrades(db: Db): TradeStore {
  return {
    async list(owner) {
      const rows = await db.select().from(trades).where(eq(trades.owner, owner)).orderBy(asc(trades.date), asc(trades.createdAt));
      return rows.map(fromRow);
    },
    async add(owner, t) {
      await db.insert(trades).values({ ...t, owner, createdAt: new Date(t.createdAt) });
    },
    async remove(owner, id) {
      const rows = await db.delete(trades).where(and(eq(trades.owner, owner), eq(trades.id, id))).returning();
      return rows[0] ? fromRow(rows[0]) : null;
    },
    async owners() {
      const rows = await db.selectDistinct({ owner: trades.owner }).from(trades);
      return rows.map((r) => r.owner);
    },
    async rename(owner, from, to) {
      const rows = await db.update(trades).set({ symbol: to }).where(and(eq(trades.owner, owner), eq(trades.symbol, from))).returning({ id: trades.id });
      return rows.length;
    },
  };
}

export function memoryTrades(): TradeStore {
  const rows = new Map<string, Trade[]>();
  const of = (owner: string) => rows.get(owner) ?? [];
  return {
    async list(owner) {
      return [...of(owner)].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
    },
    async add(owner, t) {
      rows.set(owner, [...of(owner), t]);
    },
    async remove(owner, id) {
      const hit = of(owner).find((t) => t.id === id) ?? null;
      if (hit) rows.set(owner, of(owner).filter((t) => t.id !== id));
      return hit;
    },
    async owners() {
      return [...rows].filter(([, list]) => list.length > 0).map(([o]) => o);
    },
    async rename(owner, from, to) {
      let n = 0;
      rows.set(
        owner,
        of(owner).map((t) => (t.symbol === from ? (n++, { ...t, symbol: to }) : t)),
      );
      return n;
    },
  };
}

let demo: TradeStore | null = null;
export function tradeStore(): TradeStore | null {
  const db = getDb();
  if (db) return postgresTrades(db);
  if (isDemo()) return (demo ??= memoryTrades());
  return null;
}
