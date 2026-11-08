import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchController } from "./search";

// A fetch whose answers the test releases one by one, in any order.
function controllableFetch() {
  const calls: { url: string; signal: AbortSignal; resolve: (r: Response) => void; reject: (e: unknown) => void }[] = [];
  const fetcher = (url: string, init: { signal: AbortSignal }) =>
    new Promise<Response>((resolve, reject) => {
      calls.push({ url, signal: init.signal, resolve, reject });
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  return { fetcher, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const flush = async () => {
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => vi.useRealTimers());

describe("search requests", () => {
  it("drops old results the moment the query changes", async () => {
    const { fetcher, calls } = controllableFetch();
    const c = new SearchController(fetcher);
    c.setQuery("app");
    vi.advanceTimersByTime(200);
    calls[0].resolve(json([{ symbol: "AAPL", name: "Apple" }]));
    await flush();
    expect(c.state).toMatchObject({ term: "app", status: "success" });
    c.setQuery("micro");
    expect(c.state).toEqual({ term: "micro", status: "loading", results: [], error: null });
    // Enter now must not open Apple: the visible results belong to "micro" (none yet).
    expect(c.pick(0, "micro")).toBeNull();
  });

  it("lets only the latest request update state; an older answer arriving late is ignored", async () => {
    const { fetcher, calls } = controllableFetch();
    const c = new SearchController(fetcher);
    c.setQuery("a");
    vi.advanceTimersByTime(200);
    c.setQuery("ab"); // aborts the first
    vi.advanceTimersByTime(200);
    expect(calls[0].signal.aborted).toBe(true);
    calls[1].resolve(json([{ symbol: "ABBV", name: "AbbVie" }]));
    await flush();
    calls[0].resolve(json([{ symbol: "A", name: "Agilent" }])); // too late
    await flush();
    expect(c.state.results.map((r) => r.symbol)).toEqual(["ABBV"]);
  });

  it("debounces: typing fast sends one request", () => {
    const { fetcher, calls } = controllableFetch();
    const c = new SearchController(fetcher);
    for (const q of ["n", "nv", "nvd", "nvda"]) {
      c.setQuery(q);
      vi.advanceTimersByTime(50);
    }
    vi.advanceTimersByTime(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("q=nvda");
  });

  it("treats cancellation as cancellation, and failures as typed errors", async () => {
    const { fetcher, calls } = controllableFetch();
    const c = new SearchController(fetcher);
    c.setQuery("x");
    vi.advanceTimersByTime(200);
    c.cancel();
    await flush();
    expect(c.state.status).toBe("loading"); // not "error"

    c.setQuery("y");
    vi.advanceTimersByTime(200);
    calls[1].reject(new TypeError("Failed to fetch"));
    await flush();
    expect(c.state).toMatchObject({ status: "error", error: "network" });

    for (const [status, error] of [[401, "beta_expired"], [429, "rate_limited"], [503, "unavailable"]] as const) {
      c.setQuery(`q${status}`);
      vi.advanceTimersByTime(200);
      calls[calls.length - 1].resolve(json({ error: "x" }, status));
      await flush();
      expect(c.state).toMatchObject({ status: "error", error });
    }
  });

  it("caches successful answers, never failures", async () => {
    const { fetcher, calls } = controllableFetch();
    const c = new SearchController(fetcher);
    c.setQuery("ko");
    vi.advanceTimersByTime(200);
    calls[0].resolve(json([{ symbol: "KO", name: "Coca-Cola" }]));
    await flush();
    c.setQuery("k");
    c.setQuery("ko"); // instant, no request
    expect(c.state.status).toBe("success");
    expect(calls).toHaveLength(1);

    c.setQuery("zz");
    vi.advanceTimersByTime(200);
    calls[1].resolve(json({ error: "x" }, 503));
    await flush();
    c.setQuery("z");
    c.setQuery("zz");
    vi.advanceTimersByTime(200);
    expect(calls).toHaveLength(2 + 1); // asked again
  });

  it("decides what Enter opens: active result, exact ticker, first result, or wait", async () => {
    const { fetcher, calls } = controllableFetch();
    const c = new SearchController(fetcher);
    c.setQuery("meta");
    expect(c.resolveEnter("meta", -1)).toBe("wait");
    vi.advanceTimersByTime(200);
    calls[0].resolve(json([{ symbol: "METV", name: "Roundhill" }, { symbol: "META", name: "Meta" }]));
    await flush();
    expect(c.resolveEnter("meta", -1)).toBe("META"); // exact ticker beats the first row
    expect(c.resolveEnter("meta", 0)).toBe("METV"); // the highlighted row wins
    expect(c.resolveEnter("brk.b", -1)).toBe("BRK.B"); // typed ticker not searched yet
    expect(c.resolveEnter("apple inc", -1)).toBeNull();
  });
});
