import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("./fmp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fmp")>();
  return {
    ...actual,
    fmpQuote: vi.fn(async (symbol: string) =>
      symbol === "QQQ"
        ? { ok: false, error: "plan_restricted" }
        : { ok: true, fetchedAt: "2026-11-06T21:00:00.000Z", data: { symbol, name: symbol, price: 100, change: 1, changePercent: 1 } },
    ),
  };
});

const dbMock = vi.hoisted(() => ({ db: null as unknown, search: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => dbMock.db }));
vi.mock("./securities", () => ({ searchSecurities: dbMock.search }));

import { demoAllowed, getQuote, getQuotes, isDemo, mapLimit, searchSymbols } from "./data";
import * as fmp from "./fmp";

afterEach(() => vi.unstubAllEnvs());

describe("demo mode", () => {
  it("is never allowed in production unless DEMO_MODE=1", () => {
    expect(demoAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(demoAllowed({ NODE_ENV: "production", DEMO_MODE: "1" })).toBe(true);
    expect(demoAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(demoAllowed({ NODE_ENV: "test" })).toBe(true);
  });

  it("serves simulated data only without a key, outside production", async () => {
    vi.stubEnv("FMP_API_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(isDemo()).toBe(true);
    const r = await getQuote("AAPL");
    expect(r.ok).toBe(true);

    vi.stubEnv("FMP_API_KEY", "real-key");
    expect(isDemo()).toBe(false);
  });

  it("does not fall back to simulated data in production without a key", async () => {
    vi.stubEnv("FMP_API_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "");
    expect(isDemo()).toBe(false);
  });
});

describe("getQuotes", () => {
  it("keeps request order and reports why a symbol is missing", async () => {
    vi.stubEnv("FMP_API_KEY", "real-key");
    const entries = await getQuotes(["spy", "QQQ", "1BAD", "SPY", "AAPL"]);
    expect(entries.map((e) => e.symbol)).toEqual(["SPY", "QQQ", "AAPL"]);
    expect(entries[0].quote?.price).toBe(100);
    expect(entries[1]).toEqual({ symbol: "QQQ", error: "plan_restricted" });
  });
});

describe("searchSymbols", () => {
  it("answers from the local securities table without calling FMP", async () => {
    vi.stubEnv("FMP_API_KEY", "real-key");
    dbMock.db = {};
    dbMock.search.mockResolvedValueOnce([{ symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ" }]);
    const spy = vi.spyOn(fmp, "fmpSearch");
    const r = await searchSymbols("apple");
    expect(r.ok && r.data[0].symbol).toBe("AAPL");
    expect(spy).not.toHaveBeenCalled();
  });

  it("falls back to FMP when the database fails or has no match", async () => {
    vi.stubEnv("FMP_API_KEY", "real-key");
    dbMock.db = {};
    const spy = vi.spyOn(fmp, "fmpSearch").mockResolvedValue({ ok: true, data: [], fetchedAt: "x" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    dbMock.search.mockRejectedValueOnce(new Error("db down"));
    await searchSymbols("apple");
    dbMock.search.mockResolvedValueOnce([]);
    await searchSymbols("zzzz");
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("getQuotes over the per-request limit", () => {
  it("answers the first 30 and returns the rest as skipped, never dropping them silently", async () => {
    vi.stubEnv("FMP_API_KEY", "real-key");
    const list = Array.from({ length: 35 }, (_, i) => `S${String.fromCharCode(65 + (i % 26))}${i >= 26 ? "Z" : ""}`);
    const entries = await getQuotes(list);
    expect(entries).toHaveLength(30);
    expect(entries.skipped).toEqual(list.slice(30));
  });

  it("runs at most N tasks at a time, keeping the order", async () => {
    let inFlight = 0;
    let max = 0;
    const out = await mapLimit(Array.from({ length: 20 }, (_, i) => i), 6, async (i) => {
      max = Math.max(max, ++inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return i * 2;
    });
    expect(max).toBe(6);
    expect(out).toEqual(Array.from({ length: 20 }, (_, i) => i * 2)); // order kept
  });
});
