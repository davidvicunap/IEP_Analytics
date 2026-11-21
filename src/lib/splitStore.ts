// Where detected splits are kept (Postgres; memory in demo mode, seeded from DEMO_SPLITS for
// browser checks) and the hook that detects one when a new quote is stored (see lib/splits.ts).
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { splits as table } from "@/db/schema";
import type { StoredQuote } from "./priceStore";
import { detectSplit, type Split } from "./splits";
import type { Quote } from "./types";

export interface SplitStore {
  list(symbols: string[]): Promise<Split[]>;
  add(split: Split): Promise<void>;
}

export function postgresSplits(db: Db): SplitStore {
  return {
    async list(symbols) {
      if (!symbols.length) return [];
      const rows = await db.select().from(table).where(inArray(table.symbol, symbols));
      return rows.map((r) => ({ symbol: r.symbol, date: r.date, ratio: r.ratio }));
    },
    async add(s) {
      await db.insert(table).values(s).onConflictDoNothing();
    },
  };
}

export function memorySplits(seed: Split[] = []): SplitStore {
  const rows = [...seed];
  return {
    async list(symbols) {
      return rows.filter((r) => symbols.includes(r.symbol));
    },
    async add(s) {
      if (!rows.some((r) => r.symbol === s.symbol && r.date === s.date)) rows.push(s);
    },
  };
}

/** DEMO_SPLITS="NVDA:10:2026-11-20,XYZ:0.1:2026-11-18" (symbol:ratio:date). */
export function demoSplitSeed(raw = process.env.DEMO_SPLITS ?? ""): Split[] {
  return raw
    .split(",")
    .map((x) => x.trim().split(":"))
    .filter((p) => p.length === 3 && /^[A-Z.\-]+$/.test(p[0]) && Number(p[1]) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(p[2]))
    .map(([symbol, ratio, date]) => ({ symbol, ratio: Number(ratio), date }));
}

const nyDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/** Compares a new live quote with the last stored one and records a split when it looks like one. */
export async function recordSplitIfAny(db: Db, prev: StoredQuote | undefined, quote: Quote, fetchedAt: string): Promise<Split | null> {
  if (!prev) return null;
  const at = quote.asOf ?? fetchedAt;
  const ratio = detectSplit({ price: prev.quote.price, at: prev.quote.asOf ?? prev.fetchedAt }, { price: quote.price, changePct: Number.isFinite(quote.changePercent) ? quote.changePercent : null, at });
  if (!ratio) return null;
  const split: Split = { symbol: quote.symbol, ratio, date: nyDate(at) };
  const exists = await db.select().from(table).where(and(eq(table.symbol, split.symbol), eq(table.date, split.date))).limit(1);
  if (!exists.length) {
    await db.insert(table).values(split).onConflictDoNothing();
    console.info(JSON.stringify({ event: "split_detected", ...split }));
  }
  return split;
}
