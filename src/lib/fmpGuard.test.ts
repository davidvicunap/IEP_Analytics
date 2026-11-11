import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// unstable_cache needs a Next.js server; in unit tests it calls through, so every call below
// is a "cache miss" and exercises the guard.
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

// In-memory stand-in for Upstash Redis (expiry is not simulated).
const store = new Map<string, unknown>();
const fakeRedis = {
  get: vi.fn(async (k: string) => store.get(k) ?? null),
  set: vi.fn(async (k: string, v: unknown) => {
    store.set(k, v);
    return "OK";
  }),
  incr: vi.fn(async (k: string) => {
    const n = Number(store.get(k) ?? 0) + 1;
    store.set(k, n);
    return n;
  }),
  expire: vi.fn(async () => 1),
};
vi.mock("./redis", () => ({ getRedis: () => fakeRedis }));

import { PAUSE_SECONDS, QUOTE_TTL, REMEMBER, isMarketOpen, quoteTtl, rememberKey } from "./fmpGuard";
import { fmpFundamentals, fmpMarketCaps, fmpQuote } from "./fmp";

const quoteRow = [{ symbol: "AAPL", name: "Apple Inc.", price: 230, changePercentage: 1 }];
const respond = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  store.clear();
  vi.stubEnv("FMP_API_KEY", "test-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("market hours (New York)", () => {
  it("is open 9:30–16:00 on weekdays, across daylight-saving changes", () => {
    expect(isMarketOpen(new Date("2026-11-10T14:30:00Z"))).toBe(true); // Tue 9:30 EST
    expect(isMarketOpen(new Date("2026-11-10T14:29:00Z"))).toBe(false); // 9:29
    expect(isMarketOpen(new Date("2026-11-10T20:59:00Z"))).toBe(true); // 15:59
    expect(isMarketOpen(new Date("2026-11-10T21:00:00Z"))).toBe(false); // 16:00
    expect(isMarketOpen(new Date("2026-07-14T13:30:00Z"))).toBe(true); // Tue 9:30 EDT
    expect(isMarketOpen(new Date("2026-11-14T16:00:00Z"))).toBe(false); // Saturday
  });

  it("keeps prices longer when closed, or when most of the day's quota is used", () => {
    const open = new Date("2026-11-10T16:00:00Z");
    expect(quoteTtl(open, 10, 250)).toBe(QUOTE_TTL.open);
    expect(quoteTtl(open, 200, 250)).toBe(QUOTE_TTL.openTight);
    expect(quoteTtl(open, null, 250)).toBe(QUOTE_TTL.open); // no counter: normal refresh
    expect(quoteTtl(new Date("2026-11-11T03:00:00Z"), 10, 250)).toBe(QUOTE_TTL.closed);
  });

  it("keys requests by path and sorted parameters", () => {
    expect(rememberKey("quote", { symbol: "HIMS" })).toBe("iep:fmp:known:quote?symbol=HIMS");
    expect(rememberKey("x", { b: "2", a: "1" })).toBe(rememberKey("x", { a: "1", b: "2" }));
  });
});

describe("guarded FMP calls", () => {
  it("asks once for data that isn't in the plan, then answers from memory", async () => {
    const fetch = vi.fn(respond(402, { "Error Message": "Exclusive Endpoint: not available under your current subscription" }));
    vi.stubGlobal("fetch", fetch);
    expect(await fmpQuote("HIMS")).toEqual({ ok: false, error: "plan_restricted" });
    expect(await fmpQuote("HIMS")).toEqual({ ok: false, error: "plan_restricted" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fakeRedis.set).toHaveBeenCalledWith("iep:fmp:known:quote?symbol=HIMS", "plan_restricted", { ex: REMEMBER.plan_restricted });
  });

  it("remembers per request, not per endpoint", async () => {
    const fetch = vi.fn(respond(402, { "Error Message": "not available under your current subscription" }));
    vi.stubGlobal("fetch", fetch);
    await fmpMarketCaps(["MSFT", "NVDA"]);
    vi.stubGlobal("fetch", vi.fn(respond(200, quoteRow)));
    expect((await fmpQuote("AAPL")).ok).toBe(true);
  });

  it("pauses calls after 'limit reached' instead of being refused one by one", async () => {
    const fetch = vi.fn(respond(429, { "Error Message": "Limit Reach" }));
    vi.stubGlobal("fetch", fetch);
    expect(await fmpQuote("AAPL")).toEqual({ ok: false, error: "rate_limited" });
    expect(fakeRedis.set).toHaveBeenCalledWith("iep:fmp:paused", "1", { ex: PAUSE_SECONDS });
    expect(await fmpFundamentals("MSFT")).toEqual({ ok: false, error: "rate_limited" });
    expect(fetch).toHaveBeenCalledTimes(1); // the second symbol never reached FMP
  });

  it("retries transient failures on the next view", async () => {
    const fetch = vi.fn().mockImplementationOnce(respond(500, "oops")).mockImplementation(respond(200, quoteRow));
    vi.stubGlobal("fetch", fetch);
    expect(await fmpQuote("AAPL")).toEqual({ ok: false, error: "upstream" });
    expect((await fmpQuote("AAPL")).ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
