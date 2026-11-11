import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Db } from "@/db/client";

// The fallback chain of the stock page against a real migrated database: FMP is mocked,
// the SEC company list and stored prices are real tables.
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
const fmpMock = vi.hoisted(() => ({ quote: new Map<string, unknown>(), history: new Map<string, unknown>(), historyCalls: 0 }));
vi.mock("./fmp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./fmp")>()),
  fmpQuote: vi.fn(async (s: string) => fmpMock.quote.get(s) ?? { ok: false, error: "not_found" }),
  fmpHistory: vi.fn(async (s: string) => {
    fmpMock.historyCalls++;
    return fmpMock.history.get(s) ?? { ok: false, error: "plan_restricted" };
  }),
}));
const dbHolder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => dbHolder.db }));

import { getQuotes, getStockPage } from "./data";
import { refreshSecurities } from "./securities";

const live = (symbol: string, price: number) => ({ ok: true, fetchedAt: "2026-11-10T20:00:00.000Z", data: { symbol, name: `${symbol} Inc.`, price, change: 1, changePercent: 1, exchange: "NASDAQ" } });

beforeAll(async () => {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: "./drizzle" });
  dbHolder.db = pg;
  await refreshSecurities(pg as unknown as Db, [
    { symbol: "AAPL", cik: 320193, name: "Apple Inc.", exchange: "NASDAQ", rank: 1 },
    { symbol: "HIMS", cik: 1773751, name: "Hims & Hers Health, Inc.", exchange: "NYSE", rank: 500 },
    { symbol: "SMCI", cik: 1375365, name: "Super Micro Computer, Inc.", exchange: "NASDAQ", rank: 300 },
  ]);
});

beforeEach(() => {
  vi.stubEnv("FMP_API_KEY", "test-key"); // not demo mode
  fmpMock.quote.clear();
  fmpMock.history.clear();
  fmpMock.historyCalls = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("stock page price chain", () => {
  it("uses the live quote and stores it for later", async () => {
    fmpMock.quote.set("AAPL", live("AAPL", 230));
    const page = await getStockPage("AAPL");
    expect(page).toMatchObject({ kind: "ok", identity: { symbol: "AAPL", name: "AAPL Inc." }, quote: { price: 230 }, priceIssue: null });
    expect(fmpMock.historyCalls).toBe(0);
  });

  it("falls back to the stored price, with the reason the live one failed", async () => {
    fmpMock.quote.set("AAPL", { ok: false, error: "rate_limited" });
    const page = await getStockPage("AAPL");
    expect(page).toMatchObject({ kind: "ok", quote: { price: 230, basis: "stored" }, fetchedAt: "2026-11-10T20:00:00.000Z", priceIssue: "rate_limited" });
  });

  it("builds a price from the last daily close when nothing is stored", async () => {
    fmpMock.quote.set("SMCI", { ok: false, error: "plan_restricted" });
    fmpMock.history.set("SMCI", {
      ok: true,
      fetchedAt: "2026-11-10T22:00:00.000Z",
      data: [
        { time: "2026-11-09", open: 40, high: 41, low: 39, close: 40, volume: 1 },
        { time: "2026-11-10", open: 40, high: 45, low: 40, close: 44, volume: 2 },
      ],
    });
    const page = await getStockPage("SMCI");
    expect(page).toMatchObject({
      kind: "ok",
      identity: { symbol: "SMCI", name: "Super Micro Computer, Inc.", exchange: "NASDAQ" },
      quote: { price: 44, previousClose: 40, basis: "close" },
      priceIssue: "plan_restricted",
    });
  });

  it("opens a company the SEC knows even with no price at all", async () => {
    fmpMock.quote.set("HIMS", { ok: false, error: "plan_restricted" });
    const page = await getStockPage("HIMS");
    expect(page).toEqual({
      kind: "ok",
      identity: { symbol: "HIMS", name: "Hims & Hers Health, Inc.", exchange: "NYSE" },
      quote: null,
      fetchedAt: null,
      priceIssue: "plan_restricted",
    });
  });

  it("is 'not found' only when neither FMP nor the SEC list knows the ticker", async () => {
    expect(await getStockPage("ZZZZ")).toEqual({ kind: "not_found" });
    fmpMock.quote.set("ZZZZ", { ok: false, error: "upstream" });
    expect(await getStockPage("ZZZZ")).toEqual({ kind: "unavailable", issue: "upstream" });
  });
});

describe("price lists", () => {
  it("show the stored price when FMP can't answer, never the 'missing' state", async () => {
    fmpMock.quote.set("AAPL", { ok: false, error: "rate_limited" });
    fmpMock.quote.set("MSFT", { ok: false, error: "rate_limited" });
    const [aapl, msft] = await getQuotes(["AAPL", "MSFT"]);
    expect(aapl).toMatchObject({ symbol: "AAPL", quote: { price: 230, basis: "stored" }, error: "rate_limited" });
    expect(msft).toEqual({ symbol: "MSFT", error: "rate_limited" });
  });
});
