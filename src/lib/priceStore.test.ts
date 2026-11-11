import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Db } from "@/db/client";
import { quoteFromCloses, saveQuote, storedQuotes } from "./priceStore";
import type { Candle, Quote } from "./types";

let db: Db;

beforeAll(async () => {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: "./drizzle" });
  db = pg as unknown as Db;
});

const q = (symbol: string, price: number): Quote => ({ symbol, name: `${symbol} Inc.`, price, change: 1, changePercent: 0.5 });

describe("stored quotes (real migration on PGlite)", () => {
  it("keeps the newest quote and marks it as stored when read back", async () => {
    await saveQuote(db, q("AAPL", 230), "2026-11-10T15:00:00Z");
    await saveQuote(db, q("AAPL", 231), "2026-11-10T16:00:00Z");
    await saveQuote(db, q("AAPL", 229), "2026-11-10T14:00:00Z"); // late arrival: ignored
    const got = await storedQuotes(db, ["AAPL", "NOPE"]);
    expect(got.size).toBe(1);
    expect(got.get("AAPL")).toEqual({ quote: { ...q("AAPL", 231), basis: "stored" }, fetchedAt: "2026-11-10T16:00:00.000Z" });
  });

  it("never stores the 'stored' label itself", async () => {
    await saveQuote(db, { ...q("MSFT", 500), basis: "stored" }, "2026-11-10T16:00:00Z");
    const raw = await db.select().from(schema.priceSnapshots);
    expect(raw.find((r) => r.symbol === "MSFT")?.quote).not.toHaveProperty("basis");
  });

  it("answers an empty list without a query", async () => {
    expect((await storedQuotes(db, [])).size).toBe(0);
  });
});

describe("quote from daily closes", () => {
  const day = (time: string, close: number, extra: Partial<Candle> = {}): Candle => ({ time, open: close, high: close, low: close, close, volume: 1000, ...extra });

  it("uses the last close, the change against the one before and the 52-week range", () => {
    const candles = [day("2025-06-01", 50), day("2025-12-01", 80), day("2026-11-09", 100), day("2026-11-10", 110, { open: 101, high: 112, low: 99 })];
    const quote = quoteFromCloses("HIMS", "Hims & Hers Health", candles)!;
    expect(quote).toMatchObject({ symbol: "HIMS", price: 110, change: 10, previousClose: 100, open: 101, dayHigh: 112, dayLow: 99, yearLow: 80, yearHigh: 110, basis: "close" });
    expect(quote.changePercent).toBeCloseTo(10);
    expect(quote.asOf?.slice(0, 10)).toBe("2026-11-10");
  });

  it("returns nothing without a usable close", () => {
    expect(quoteFromCloses("X", "X", [])).toBeNull();
    expect(quoteFromCloses("X", "X", [day("2026-11-10", 0)])).toBeNull();
  });
});
