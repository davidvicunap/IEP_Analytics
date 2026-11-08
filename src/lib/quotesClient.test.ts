import { describe, expect, it } from "vitest";
import { QuotesClient, retryAfterMs } from "./quotesClient";
import type { QuotesResponse } from "./types";

const quote = (symbol: string) => ({ symbol, name: symbol, price: 10, change: 0, changePercent: 1 });
const ok = (symbols: string[], missing: string[] = []): Response =>
  new Response(
    JSON.stringify({
      source: "DEMO",
      limit: 30,
      quotes: symbols.filter((s) => !missing.includes(s)).map((s) => ({ ...quote(s), fetchedAt: "2026-11-07T21:00:00.000Z" })),
      missing: missing.map((symbol) => ({ symbol, error: "rate_limited" })),
      skipped: [],
    } satisfies QuotesResponse),
  );
const symbolsOf = (url: string) => decodeURIComponent(url.split("symbols=")[1]).split(",");

describe("quotes client", () => {
  it("pages long lists 30 at a time, at most 2 requests in flight", async () => {
    const urls: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const c = new QuotesClient(async (url) => {
      urls.push(url);
      maxInFlight = Math.max(maxInFlight, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return ok(symbolsOf(url));
    });
    const list = Array.from({ length: 75 }, (_, i) => `S${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`);
    const out = await c.fetch(list, new AbortController().signal);
    expect(urls.map((u) => symbolsOf(u).length)).toEqual([30, 30, 15]);
    expect(maxInFlight).toBe(2);
    expect(out.slots.size).toBe(75);
    expect(out.issue).toBeNull();
  });

  it("keeps per-symbol failures and the last good value", async () => {
    let fail = false;
    const c = new QuotesClient(async (url) => ok(symbolsOf(url), fail ? ["MSFT"] : []));
    await c.fetch(["AAPL", "MSFT"], new AbortController().signal);
    fail = true;
    const out = await c.fetch(["AAPL", "MSFT"], new AbortController().signal);
    expect(out.slots.get("MSFT")?.error).toBe("rate_limited"); // the latest attempt failed…
    expect(c.cache.get("MSFT")?.quote?.price).toBe(10); // …but the last good value stays
  });

  it("reports an expired beta session and honours Retry-After", async () => {
    let now = 1_000_000;
    const expired = new QuotesClient(async () => new Response("{}", { status: 401 }), () => now);
    expect((await expired.fetch(["AAPL"], new AbortController().signal)).issue).toBe("beta_expired");

    let calls = 0;
    const limited = new QuotesClient(async () => {
      calls++;
      return new Response("{}", { status: 429, headers: { "Retry-After": "30" } });
    }, () => now);
    const first = await limited.fetch(["AAPL"], new AbortController().signal);
    expect(first).toMatchObject({ issue: "rate_limited", retryAfterMs: 30_000 });
    now += 10_000;
    const second = await limited.fetch(["AAPL"], new AbortController().signal);
    expect(second.issue).toBe("rate_limited");
    expect(calls).toBe(1); // no request until the wait is over
  });

  it("never writes a cancelled answer into the shared cache", async () => {
    const ctrl = new AbortController();
    const c = new QuotesClient(async (url, { signal }) => {
      await new Promise((r) => setTimeout(r, 5));
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      return ok(symbolsOf(url));
    });
    const p = c.fetch(["AAPL"], ctrl.signal);
    ctrl.abort();
    await expect(p).rejects.toThrow();
    expect(c.cache.has("AAPL")).toBe(false);
  });

  it("shares identical requests, and one caller cancelling doesn't fail the other", async () => {
    let calls = 0;
    const c = new QuotesClient(async (url, { signal }) => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      return ok(symbolsOf(url));
    });
    const a = new AbortController();
    const pa = c.fetch(["AAPL"], a.signal);
    const pb = c.fetch(["AAPL"], new AbortController().signal);
    a.abort();
    await expect(pa).rejects.toThrow();
    const b = await pb;
    expect(b.slots.get("AAPL")?.quote?.symbol).toBe("AAPL");
    expect(calls).toBe(2); // shared at first, re-asked once the owner cancelled
  });

  it("serves primed (server-rendered) quotes without asking again while fresh", () => {
    let now = 0;
    const c = new QuotesClient(async () => ok([]), () => now);
    c.prime([{ symbol: "AAPL", quote: quote("AAPL") }], "FMP");
    expect(c.staleSymbols(["AAPL", "MSFT"], 60_000)).toEqual(["MSFT"]);
    now = 61_000;
    expect(c.staleSymbols(["AAPL"], 60_000)).toEqual(["AAPL"]);
  });

  it("reads Retry-After as seconds or a date", () => {
    expect(retryAfterMs("12", 0)).toBe(12_000);
    expect(retryAfterMs(new Date(5_000).toUTCString(), 0)).toBe(5_000);
    expect(retryAfterMs("soon", 0)).toBeNull();
  });
});
