import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Db } from "@/db/client";
import { memoryTrades, postgresTrades, type TradeStore } from "./tradeStore";
import type { Trade } from "./trades";

const trade = (id: string, date: string, extra: Partial<Trade> = {}): Trade => ({ id, symbol: "AAPL", side: "buy", date, shares: 2.5, price: 230.12, fees: 1, stop: 210, note: "first", createdAt: `${date}T15:00:00.000Z`, ...extra });

let pg: Db;
beforeAll(async () => {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  pg = db as unknown as Db;
});

describe.each([
  ["Postgres (real migration on PGlite)", () => postgresTrades(pg)],
  ["memory (demo)", () => memoryTrades()],
])("trade store: %s", (_name, make: () => TradeStore) => {
  it("keeps each label's trades apart, oldest first, and removes only the owner's", async () => {
    const s = make();
    await s.add("ana", trade("b", "2026-03-01", { side: "sell", stop: null, note: "" }));
    await s.add("ana", trade("a", "2026-01-15"));
    await s.add("luis", trade("c", "2026-02-01"));
    expect((await s.list("ana")).map((t) => t.id)).toEqual(["a", "b"]);
    expect((await s.list("ana"))[0]).toEqual(trade("a", "2026-01-15"));
    expect(await s.remove("luis", "a")).toBeNull();
    expect((await s.remove("ana", "a"))?.id).toBe("a");
    expect((await s.list("ana")).map((t) => t.id)).toEqual(["b"]);
    expect(await s.list("luis")).toHaveLength(1);
  });
});
