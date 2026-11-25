import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// unstable_cache needs a Next.js server; in unit tests it simply calls through.
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

import {
  fmpEquityRiskPremium, fmpQuote, fmpQuotes, fmpSearch, fmpTreasury10y,
  kindFromMessage, kindFromStatus,
} from "./fmp";

const KEY = "test-secret-key-123";

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
}

let logs: string[];

beforeEach(() => {
  vi.stubEnv("FMP_API_KEY", KEY);
  logs = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("error classification", () => {
  it("maps HTTP statuses", () => {
    expect(kindFromStatus(401, "")).toBe("unauthorized");
    expect(kindFromStatus(402, "")).toBe("plan_restricted");
    expect(kindFromStatus(404, "")).toBe("not_found");
    expect(kindFromStatus(429, "")).toBe("rate_limited");
    expect(kindFromStatus(403, "Exclusive Endpoint: not available under your current subscription")).toBe("plan_restricted");
    expect(kindFromStatus(403, "Forbidden")).toBe("unauthorized");
    expect(kindFromStatus(500, "")).toBe("upstream");
  });

  it("maps error messages sent with HTTP 200", () => {
    expect(kindFromMessage("Limit Reach . Please upgrade your plan or visit our documentation")).toBe("rate_limited");
    expect(kindFromMessage("Premium Query Parameter: this value is not available under your current subscription")).toBe("plan_restricted");
    expect(kindFromMessage("Invalid API KEY. Feel free to create a Free API Key")).toBe("unauthorized");
    expect(kindFromMessage("Something odd happened")).toBe("upstream");
  });
});

describe("fmpQuote", () => {
  it("maps a quote and its trade time", async () => {
    vi.stubGlobal("fetch", respond(200, [{ symbol: "AAPL", name: "Apple Inc.", price: 344.17, changePercentage: -1.53, timestamp: 1793995200 }]));
    const r = await fmpQuote("AAPL");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.price).toBe(344.17);
      expect(r.data.changePercent).toBe(-1.53);
      expect(r.data.asOf).toBe(new Date(1793995200 * 1000).toISOString());
      expect(r.fetchedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    }
  });

  it("returns not_found for an unknown symbol", async () => {
    vi.stubGlobal("fetch", respond(200, []));
    expect(await fmpQuote("ZZZZ")).toEqual({ ok: false, error: "not_found" });
  });

  it.each([
    [429, "Too Many Requests", "rate_limited"],
    [402, { "Error Message": "Restricted" }, "plan_restricted"],
    [401, { "Error Message": "Invalid API KEY" }, "unauthorized"],
    [503, "Service Unavailable", "upstream"],
    [200, { "Error Message": "Limit Reach . Please upgrade your plan" }, "rate_limited"],
    [200, "<html>not json</html>", "upstream"],
  ])("HTTP %s → %s", async (status, body, kind) => {
    vi.stubGlobal("fetch", respond(status as number, body));
    expect(await fmpQuote("AAPL")).toEqual({ ok: false, error: kind });
  });

  it("reports network failures as upstream", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect(await fmpQuote("AAPL")).toEqual({ ok: false, error: "upstream" });
  });

  it("reports a missing key as not_configured without calling FMP", async () => {
    vi.stubEnv("FMP_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await fmpQuote("AAPL")).toEqual({ ok: false, error: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs a plan restriction as a warning, not an error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", respond(402, "Payment Required"));
    await fmpQuote("ZZZZ");
    expect(logs).toEqual([]);
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({ event: "provider_error", kind: "plan_restricted", status: 402 });
  });

  it("never writes the API key to the logs", async () => {
    vi.stubGlobal("fetch", respond(429, "Too Many Requests"));
    await fmpQuote("AAPL");
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join("\n")).not.toContain(KEY);
    expect(JSON.parse(logs[0])).toMatchObject({ event: "provider_error", endpoint: "quote", kind: "rate_limited", status: 429 });
  });
});

describe("partial results", () => {
  it("merges search results and keeps US listings only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes("search-symbol")
              ? [{ symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ" }, { symbol: "AAPL.L", name: "Apple LSE", exchange: "LSE" }]
              : [{ symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ" }, { symbol: "APLE", name: "Apple Hospitality", exchange: "NYSE" }],
          ),
          { status: 200 },
        ),
      ),
    );
    const r = await fmpSearch("apple");
    expect(r.ok && r.data.map((x) => x.symbol)).toEqual(["AAPL", "APLE"]);
  });
});

describe("valuation inputs", () => {
  it("takes the latest 10-year Treasury yield as a fraction", async () => {
    vi.stubGlobal(
      "fetch",
      respond(200, [
        { date: "2026-11-05", month1: 4.03, year10: 4.84 },
        { date: "2026-11-06", month1: 4.02, year10: 4.86 },
      ]),
    );
    const r = await fmpTreasury10y();
    expect(r.ok && r.data).toEqual({ value: 0.0486, date: "2026-11-06" });
  });

  it("reads the US equity risk premium", async () => {
    vi.stubGlobal(
      "fetch",
      respond(200, [
        { country: "United Kingdom", countryRiskPremium: 0.78, totalEquityRiskPremium: 5.01 },
        { country: "United States", countryRiskPremium: 0.23, totalEquityRiskPremium: 4.46 },
      ]),
    );
    const r = await fmpEquityRiskPremium();
    expect(r.ok && r.data.value).toBeCloseTo(0.0446);
  });
});

describe("batch quotes", () => {
  const row = (symbol: string, price: number) => ({ symbol, name: `${symbol} Inc.`, price, change: 1, changePercentage: 0.5, timestamp: 1764000000 });

  it("asks once for the whole set, in a stable order, and maps each symbol", async () => {
    const fetchMock = respond(200, [row("MSFT", 400), row("AAPL", 230)]);
    vi.stubGlobal("fetch", fetchMock);
    const r = await fmpQuotes(["MSFT", "AAPL", "ZZZZ", "AAPL"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toContain("/batch-quote?");
    expect(new URL(url).searchParams.get("symbols")).toBe("AAPL,MSFT,ZZZZ");
    expect(r!.get("AAPL")).toMatchObject({ ok: true, data: { symbol: "AAPL", price: 230 } });
    expect(r!.get("MSFT")).toMatchObject({ ok: true, data: { price: 400 } });
    expect(r!.get("ZZZZ")).toEqual({ ok: false, error: "not_found" });
  });

  it("gives way to per-symbol quotes when the plan doesn't include it or the call fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", respond(402, "Restricted Endpoint"));
    expect(await fmpQuotes(["AAPL", "MSFT"])).toBeNull();
    vi.stubGlobal("fetch", respond(500, "oops"));
    expect(await fmpQuotes(["AAPL", "MSFT"])).toBeNull();
    expect(logs.join(" ")).not.toContain(KEY);
  });

  it("makes no call for an empty list", async () => {
    const fetchMock = respond(200, []);
    vi.stubGlobal("fetch", fetchMock);
    expect((await fmpQuotes([]))?.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
