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

import { demoAllowed, getQuote, getQuotes, isDemo } from "./data";

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
