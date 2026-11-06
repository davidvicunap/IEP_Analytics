"use client";

import { useEffect, useState } from "react";
import type { DataIssue, Quote } from "./types";

export interface QuotesState {
  quotes: Quote[];
  missing: { symbol: string; error: DataIssue }[];
}

/** Fetches quotes for the given symbols and refreshes every 60 s while the tab is visible. */
export function useQuotes(symbols: string[]): QuotesState | null {
  const key = symbols.join(",");
  const [state, setState] = useState<QuotesState | null>(null);

  useEffect(() => {
    if (!key) {
      setState({ quotes: [], missing: [] });
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(key)}`);
        if (!alive) return;
        if (res.ok) {
          setState(await res.json());
        } else {
          // Keep the last good values; mark everything as unavailable only on first load.
          setState((s) => s ?? { quotes: [], missing: key.split(",").map((symbol) => ({ symbol, error: "upstream" })) });
        }
      } catch {
        if (alive) setState((s) => s ?? { quotes: [], missing: key.split(",").map((symbol) => ({ symbol, error: "upstream" })) });
      }
    };
    load();
    const id = setInterval(() => document.visibilityState === "visible" && load(), 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [key]);

  return state;
}
