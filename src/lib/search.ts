// Search request logic, kept apart from the UI so its races can be tested.
// - Every keystroke starts over: results that belong to an older query are dropped at once,
//   so Enter can never open a result for something the user no longer typed.
// - Requests are debounced; a newer one aborts the older; only the latest may update state.
// - Cancellation is not a failure. Failures are typed (unavailable, network, beta expired,
//   rate limited) so the UI can say something useful.
// - Successful answers are cached for a few minutes (the server caches them too); failures
//   are never cached.
import type { SearchResult } from "./types";

export type SearchStatus = "idle" | "loading" | "success" | "empty" | "error";
export type SearchError = "unavailable" | "network" | "beta_expired" | "rate_limited";

export interface SearchState {
  term: string; // normalized current query
  status: SearchStatus;
  results: SearchResult[]; // always for `term` (empty unless status is success)
  error: SearchError | null;
}

type Fetcher = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

interface Options {
  debounceMs?: number;
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

export const normalizeTerm = (q: string) => q.trim().replace(/\s+/g, " ").slice(0, 40);
export const TICKER = /^[A-Z][A-Z.\-]{0,9}$/;

export class SearchController {
  state: SearchState = { term: "", status: "idle", results: [], error: null };
  private listeners = new Set<(s: SearchState) => void>();
  private cache = new Map<string, { results: SearchResult[]; at: number }>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ctrl: AbortController | null = null;
  private seq = 0;
  private opts: Required<Options>;

  constructor(
    private fetcher: Fetcher = (u, i) => fetch(u, i),
    opts: Options = {},
  ) {
    this.opts = { debounceMs: 200, ttlMs: 5 * 60_000, maxEntries: 50, now: () => Date.now(), ...opts };
  }

  subscribe(fn: (s: SearchState) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private set(next: SearchState) {
    this.state = next;
    this.listeners.forEach((l) => l(next));
  }

  setQuery(raw: string) {
    const term = normalizeTerm(raw);
    if (term === this.state.term && this.state.status !== "error") return;
    this.cancel();
    if (!term) return this.set({ term, status: "idle", results: [], error: null });
    const hit = this.cache.get(term.toLowerCase());
    if (hit && this.opts.now() - hit.at < this.opts.ttlMs) {
      return this.set({ term, status: hit.results.length ? "success" : "empty", results: hit.results, error: null });
    }
    this.set({ term, status: "loading", results: [], error: null });
    const id = ++this.seq;
    this.timer = setTimeout(() => void this.run(term, id), this.opts.debounceMs);
  }

  /** Try the current query again (after an error). */
  retry() {
    const term = this.state.term;
    this.state = { ...this.state, term: "" };
    this.setQuery(term);
  }

  /** Stop pending work (unmount, or the query changed). */
  cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.ctrl?.abort();
    this.ctrl = null;
  }

  private async run(term: string, id: number) {
    this.timer = null;
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    try {
      const res = await this.fetcher(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
      if (id !== this.seq) return;
      if (!res.ok) {
        const error: SearchError = res.status === 401 ? "beta_expired" : res.status === 429 ? "rate_limited" : "unavailable";
        return this.set({ term, status: "error", results: [], error });
      }
      const results = (await res.json()) as SearchResult[];
      if (id !== this.seq) return;
      this.remember(term, results);
      this.set({ term, status: results.length ? "success" : "empty", results, error: null });
    } catch {
      if (ctrl.signal.aborted || id !== this.seq) return; // cancelled, not failed
      this.set({ term, status: "error", results: [], error: "network" });
    } finally {
      if (this.ctrl === ctrl) this.ctrl = null;
    }
  }

  private remember(term: string, results: SearchResult[]) {
    const key = term.toLowerCase();
    this.cache.delete(key);
    this.cache.set(key, { results, at: this.opts.now() });
    while (this.cache.size > this.opts.maxEntries) this.cache.delete(this.cache.keys().next().value!);
  }

  /** The result at `index`, only if it belongs to what's typed now. */
  pick(index: number, currentRaw: string): SearchResult | null {
    if (normalizeTerm(currentRaw) !== this.state.term || this.state.status !== "success") return null;
    return this.state.results[index] ?? null;
  }

  /**
   * What Enter should open for `currentRaw`: the active result, else an exact ticker match,
   * else the first result. While the answer is still coming, a typed ticker is opened as is.
   * Returns "wait" when the best answer is still loading and the text isn't a ticker.
   */
  resolveEnter(currentRaw: string, active: number): string | "wait" | null {
    const term = normalizeTerm(currentRaw);
    if (!term) return null;
    const upper = term.toUpperCase();
    if (this.state.term === term && this.state.status === "success") {
      const r = this.state.results;
      return (r[active] ?? r.find((x) => x.symbol === upper) ?? r[0]).symbol;
    }
    if (this.state.term === term && this.state.status === "loading") return "wait";
    return TICKER.test(upper) ? upper : null;
  }
}
