"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { quotesClient, type QuoteSlot, type RequestIssue } from "./quotesClient";
import type { DataIssue, DataSource, Quote } from "./types";

export const REFRESH_MS = 60_000;

export interface QuoteView {
  symbol: string;
  quote?: Quote; // last good value, even if the latest refresh failed
  error?: DataIssue; // why there is no value (or why the latest refresh failed)
  fetchedAt?: string;
  stale: boolean; // showing a value older than the latest attempt
}

export interface QuotesState {
  items: QuoteView[]; // in the order asked for
  loading: boolean; // first load, nothing to show yet
  refreshing: boolean; // updating values already on screen
  issue: RequestIssue | null; // a whole request failed (beta expired, rate limit, offline…)
  retryAt: number | null; // when a rate-limited refresh may be tried again
  lastUpdated: number | null;
  source: DataSource | null;
  refresh: () => void;
}

function view(symbol: string, latest: QuoteSlot | undefined): QuoteView {
  const cached = quotesClient.cache.get(symbol);
  const quote = cached?.quote;
  const error = latest?.error ?? (quote ? undefined : cached?.error);
  // Stale: the latest refresh failed, or the server sent its last stored price (basis).
  return { symbol, quote, error, fetchedAt: cached?.fetchedAt, stale: Boolean(quote && (latest?.error || quote.basis)) };
}

/**
 * Quotes for `symbols`, refreshed every minute while the page is visible and online.
 * - Values already in the shared cache (e.g. rendered by the server) show at once and are
 *   only requested again when older than a minute.
 * - Each change of symbol set or refresh cancels the previous request, and only the latest
 *   one may update state, so an old list can't overwrite the current one.
 * - Last good values stay on screen when a refresh fails; they are marked stale.
 */
export function useQuotes(symbols: string[], { enabled = true }: { enabled?: boolean } = {}): QuotesState {
  const key = symbols.join(",");
  const [items, setItems] = useState<QuoteView[]>(() => symbols.map((s) => view(s, undefined)));
  const [loading, setLoading] = useState(() => symbols.some((s) => !quotesClient.cache.get(s)));
  const [refreshing, setRefreshing] = useState(false);
  const [issue, setIssue] = useState<RequestIssue | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [source, setSource] = useState<DataSource | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const latest = useRef(new Map<string, QuoteSlot>());
  const runRef = useRef<(force: boolean) => void>(() => {});

  const run = useCallback(
    async (force: boolean) => {
      const list = key ? key.split(",") : [];
      if (!enabled || list.length === 0) {
        setItems([]);
        setLoading(false);
        return;
      }
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setIssue("offline");
        return;
      }
      const wanted = force ? list : quotesClient.staleSymbols(list, REFRESH_MS);
      setItems(list.map((s) => view(s, latest.current.get(s))));
      if (wanted.length === 0) {
        setLoading(false);
        return;
      }
      ctrlRef.current?.abort(); // one request at a time: the newest wins
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      const hasAny = list.some((s) => quotesClient.cache.get(s)?.quote);
      setRefreshing(hasAny);
      setLoading(!hasAny);
      try {
        const out = await quotesClient.fetch(wanted, ctrl.signal);
        if (ctrl.signal.aborted || ctrlRef.current !== ctrl) return;
        for (const [s, slot] of out.slots) latest.current.set(s, slot);
        setIssue(out.issue);
        setRetryAt(out.retryAfterMs != null ? Date.now() + out.retryAfterMs : null);
        if (out.slots.size) {
          setLastUpdated(Date.now());
          setSource([...out.slots.values()][0].source ?? null);
        }
        setItems(list.map((s) => view(s, latest.current.get(s))));
      } catch {
        if (ctrl.signal.aborted) return; // cancelled: a newer request owns the state
        setIssue("upstream");
      } finally {
        if (ctrlRef.current === ctrl) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [key, enabled],
  );
  runRef.current = run;

  useEffect(() => {
    run(false);
    const tick = () => runRef.current(false);
    const id = setInterval(tick, REFRESH_MS);
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", tick);
      ctrlRef.current?.abort();
    };
  }, [run]);

  const refresh = useCallback(() => runRef.current(true), []);
  return { items, loading, refreshing, issue, retryAt, lastUpdated, source, refresh };
}
