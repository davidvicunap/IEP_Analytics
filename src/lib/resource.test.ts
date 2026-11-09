import { describe, expect, it, vi } from "vitest";
import { INITIAL, createSharedLoader, fetchViewResult, isRetryable, reduce, shown, toViewResult, type Resource } from "./resource";

const ok = { ok: true as const, data: { n: 1 }, fetchedAt: "2026-11-09T00:00:00Z" };
const okState: Resource<{ n: number }> = { status: "ok", data: { n: 1 }, fetchedAt: "2026-11-09T00:00:00Z" };
const json = (status: number, body: unknown) => new Response(body === undefined ? "not json" : JSON.stringify(body), { status });

describe("resource state machine", () => {
  it("starts loading with nothing to show", () => {
    expect(INITIAL).toEqual({ status: "loading", previous: null });
    expect(shown(INITIAL)).toBeNull();
  });

  it("settles into ok or error", () => {
    expect(reduce(INITIAL, { type: "settle", result: ok })).toEqual(okState);
    expect(reduce(INITIAL, { type: "settle", result: { ok: false, error: "not_found" } })).toEqual({ status: "error", issue: "not_found" });
  });

  it("forgets the old data on a new request, unless asked to keep it on screen", () => {
    expect(reduce(okState, { type: "start", keepPrevious: false })).toEqual({ status: "loading", previous: null });
    const kept = reduce(okState, { type: "start", keepPrevious: true });
    expect(kept).toEqual({ status: "loading", previous: { data: { n: 1 }, fetchedAt: okState.fetchedAt } });
    expect(shown(kept)?.data).toEqual({ n: 1 });
    // Two quick changes in a row still keep the last good data.
    expect(reduce(kept, { type: "start", keepPrevious: true })).toEqual(kept);
  });

  it("never shows a failed answer's predecessor as current", () => {
    const err = reduce(okState, { type: "settle", result: { ok: false, error: "upstream" } });
    expect(shown(err)).toBeNull();
    expect(reduce(err, { type: "start", keepPrevious: true })).toEqual({ status: "loading", previous: null });
  });

  it("offers a retry only for transient issues", () => {
    expect(isRetryable("upstream")).toBe(true);
    expect(isRetryable("rate_limited")).toBe(true);
    for (const i of ["not_found", "not_configured", "plan_restricted", "unauthorized", "beta_expired"] as const) expect(isRetryable(i)).toBe(false);
  });
});

describe("reading API responses", () => {
  it("trusts our envelope whatever the status", () => {
    expect(toViewResult(200, ok)).toEqual(ok);
    expect(toViewResult(404, { ok: false, error: "not_found" })).toEqual({ ok: false, error: "not_found" });
    expect(toViewResult(503, { ok: false, error: "not_configured" })).toEqual({ ok: false, error: "not_configured" });
  });

  it("reads the beta gate's 401 as an expired session, not a provider problem", () => {
    expect(toViewResult(401, { error: "beta_required" })).toEqual({ ok: false, error: "beta_expired" });
    expect(toViewResult(401, null)).toEqual({ ok: false, error: "beta_expired" });
  });

  it("reads the edge rate limit and anything unreadable", () => {
    expect(toViewResult(429, { error: "rate_limited" })).toEqual({ ok: false, error: "rate_limited" });
    expect(toViewResult(502, null)).toEqual({ ok: false, error: "upstream" });
    expect(toViewResult(500, { error: "something_else" })).toEqual({ ok: false, error: "upstream" });
    expect(toViewResult(503, { error: "plan_restricted" })).toEqual({ ok: false, error: "plan_restricted" });
  });

  it("turns network failures into upstream, but lets aborts through", async () => {
    expect(await fetchViewResult("/x", undefined, () => Promise.reject(new TypeError("offline")))).toEqual({ ok: false, error: "upstream" });
    expect(await fetchViewResult("/x", undefined, async () => json(200, undefined))).toEqual({ ok: false, error: "upstream" });
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(fetchViewResult("/x", ctrl.signal, () => Promise.reject(new DOMException("aborted", "AbortError")))).rejects.toThrow();
  });
});

describe("shared loader", () => {
  it("makes one request per URL and keeps successes", async () => {
    const fetcher = vi.fn(async () => json(200, ok));
    const l = createSharedLoader(fetcher);
    const [a, b] = await Promise.all([l.load("/a"), l.load("/a")]);
    expect(a).toEqual(ok);
    expect(b).toBe(a);
    await l.load("/a");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("drops failures so the next view asks again", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(502, null)).mockResolvedValueOnce(json(200, ok));
    const l = createSharedLoader(fetcher);
    expect(await l.load("/a")).toEqual({ ok: false, error: "upstream" });
    await Promise.resolve();
    expect(await l.load("/a")).toEqual(ok);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("forgets a URL on request (retry)", async () => {
    const fetcher = vi.fn(async () => json(200, ok));
    const l = createSharedLoader(fetcher);
    await l.load("/a");
    l.forget("/a");
    await l.load("/a");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
