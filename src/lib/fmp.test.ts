import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// unstable_cache needs a Next.js server; in unit tests it simply calls through.
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

import { fmpEquityRiskPremium, fmpFundamentals, fmpMarketCaps, fmpQuote, fmpSearch, fmpTreasury10y, kindFromMessage, kindFromStatus } from "./fmp";

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

  it("never writes the API key to the logs", async () => {
    vi.stubGlobal("fetch", respond(429, "Too Many Requests"));
    await fmpQuote("AAPL");
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join("\n")).not.toContain(KEY);
    expect(JSON.parse(logs[0])).toMatchObject({ event: "provider_error", endpoint: "quote", kind: "rate_limited", status: 429 });
  });
});

describe("partial results", () => {
  it("keeps fundamentals when only one of the two endpoints fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("ratios-ttm")
          ? new Response("Too Many Requests", { status: 429 })
          : new Response(JSON.stringify([{ returnOnEquityTTM: 0.31 }]), { status: 200 }),
      ),
    );
    const r = await fmpFundamentals("MSFT");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.roe).toBe(0.31);
  });

  it("reports the error when both fundamentals endpoints fail", async () => {
    vi.stubGlobal("fetch", respond(402, { "Error Message": "Restricted" }));
    expect(await fmpFundamentals("MSFT")).toEqual({ ok: false, error: "plan_restricted" });
  });

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

  it("returns market caps for the symbols the plan covers and skips the rest", async () => {
    const fetchMock = respond(200, [
      { symbol: "JPM", date: "2026-11-06", marketCap: 889137973100 },
      { symbol: "WFC", date: "2026-11-06", marketCap: 251975289000 },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const r = await fmpMarketCaps(["wfc", "JPM", "ADM", "JPM"]);
    expect(r.ok && r.data).toEqual({ JPM: 889137973100, WFC: 251975289000 });
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toContain("market-capitalization-batch?symbols=ADM%2CJPM%2CWFC");
  });

  it("reports a plan restriction instead of an empty answer", async () => {
    vi.stubGlobal("fetch", respond(402, "Restricted Endpoint"));
    const r = await fmpMarketCaps(["ADM"]);
    expect(r).toEqual({ ok: false, error: "plan_restricted" });
  });
});
