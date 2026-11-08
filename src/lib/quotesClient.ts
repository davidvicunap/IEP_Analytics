// Browser-side quotes: one shared cache for every view (home, mini-watchlist, watchlist),
// so a symbol fetched (or server-rendered) a moment ago isn't asked for again.
// - Lists longer than the server's per-request limit are paged, two requests at a time.
// - Identical in-flight requests are shared.
// - Failures are typed: provider issues per symbol, plus whole-request problems such as the
//   beta session expiring (401), our own rate limit (429 + Retry-After) or being offline.
import type { DataIssue, DataSource, Quote, QuotesResponse } from "./types";

export const PAGE_SIZE = 30;
const PAGE_CONCURRENCY = 2;

export type RequestIssue = "beta_expired" | "rate_limited" | "offline" | "upstream";

export interface QuoteSlot {
  quote?: Quote;
  error?: DataIssue;
  fetchedAt?: string; // when the server got it from the provider
  receivedAt: number; // when this browser got it (ms)
  source?: DataSource;
}

export interface FetchOutcome {
  slots: Map<string, QuoteSlot>;
  issue: RequestIssue | null; // a page failed as a whole
  retryAfterMs: number | null;
}

type Fetcher = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

export class QuotesClient {
  readonly cache = new Map<string, QuoteSlot>();
  private inflight = new Map<string, Promise<PageResult>>();
  blockedUntil = 0; // set from Retry-After

  constructor(
    private fetcher: Fetcher = (u, i) => fetch(u, i),
    private now: () => number = () => Date.now(),
  ) {}

  /** Seed the cache with quotes the server already rendered (no request needed). */
  prime(entries: { symbol: string; quote?: Quote; error?: DataIssue; fetchedAt?: string }[], source: DataSource) {
    const at = this.now();
    for (const e of entries) {
      if (e.quote) this.cache.set(e.symbol, { quote: e.quote, fetchedAt: e.fetchedAt, receivedAt: at, source });
    }
  }

  /** Symbols whose cached quote is older than `maxAgeMs` (or missing). */
  staleSymbols(symbols: string[], maxAgeMs: number): string[] {
    const t = this.now();
    return symbols.filter((s) => {
      const c = this.cache.get(s);
      return !c?.quote || t - c.receivedAt > maxAgeMs;
    });
  }

  async fetch(symbols: string[], signal: AbortSignal): Promise<FetchOutcome> {
    const slots = new Map<string, QuoteSlot>();
    if (symbols.length === 0) return { slots, issue: null, retryAfterMs: null };
    if (this.now() < this.blockedUntil) {
      return { slots, issue: "rate_limited", retryAfterMs: this.blockedUntil - this.now() };
    }
    const pages: string[][] = [];
    for (let i = 0; i < symbols.length; i += PAGE_SIZE) pages.push(symbols.slice(i, i + PAGE_SIZE));
    let issue: RequestIssue | null = null;
    let retryAfterMs: number | null = null;
    let next = 0;
    const worker = async () => {
      while (next < pages.length) {
        const page = pages[next++];
        const r = await this.page(page, signal);
        if (r.issue) {
          issue ??= r.issue;
          if (r.retryAfterMs != null) retryAfterMs = Math.max(retryAfterMs ?? 0, r.retryAfterMs);
          continue;
        }
        for (const [s, slot] of r.slots) slots.set(s, slot);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, pages.length) }, worker));
    // Only results of this (latest) request reach the shared cache, and never on abort.
    if (!signal.aborted) for (const [s, slot] of slots) if (slot.quote || !this.cache.get(s)?.quote) this.cache.set(s, slot);
    return { slots, issue, retryAfterMs };
  }

  private async page(symbols: string[], signal: AbortSignal): Promise<PageResult> {
    const key = symbols.join(",");
    const shared = this.inflight.get(key);
    if (shared) {
      try {
        return await shared;
      } catch (e) {
        if (signal.aborted) throw e; // the other caller cancelled; we still want an answer
      }
    }
    const p: Promise<PageResult> = this.request(symbols, signal).finally(() => {
      if (this.inflight.get(key) === p) this.inflight.delete(key);
    });
    this.inflight.set(key, p);
    return p;
  }

  private async request(symbols: string[], signal: AbortSignal): Promise<PageResult> {
    let res: Response;
    try {
      res = await this.fetcher(`/api/quotes?symbols=${encodeURIComponent(symbols.join(","))}`, { signal });
    } catch (e) {
      if (signal.aborted) throw e; // cancellation is not a failure: let the caller ignore it
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      return { slots: new Map(), issue: offline ? "offline" : "upstream", retryAfterMs: null };
    }
    if (res.status === 401) return { slots: new Map(), issue: "beta_expired", retryAfterMs: null };
    if (res.status === 429) {
      const ra = retryAfterMs(res.headers.get("Retry-After"), this.now());
      this.blockedUntil = this.now() + (ra ?? 60_000);
      return { slots: new Map(), issue: "rate_limited", retryAfterMs: ra ?? 60_000 };
    }
    if (!res.ok) return { slots: new Map(), issue: "upstream", retryAfterMs: null };
    const body = (await res.json()) as QuotesResponse;
    const at = this.now();
    const slots = new Map<string, QuoteSlot>();
    for (const { fetchedAt, ...quote } of body.quotes) slots.set(quote.symbol, { quote, fetchedAt, receivedAt: at, source: body.source });
    for (const m of body.missing) slots.set(m.symbol, { error: m.error, receivedAt: at, source: body.source });
    return { slots, issue: null, retryAfterMs: null };
  }
}

interface PageResult {
  slots: Map<string, QuoteSlot>;
  issue: RequestIssue | null;
  retryAfterMs: number | null;
}

/** Retry-After as seconds or an HTTP date → milliseconds from now. */
export function retryAfterMs(header: string | null, now: number): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/** The one client the app uses. */
export const quotesClient = new QuotesClient();
