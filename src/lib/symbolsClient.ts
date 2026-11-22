"use client";

// Listings and splits for a set of tickers (one shared request per set). While it loads or if it
// fails, nothing is assumed: listings read as unknown and no split is applied.
import { useMemo } from "react";
import type { Listing } from "./listings";
import type { Split } from "./splits";
import type { SymbolInfo } from "./symbolsData";
import { useResource } from "./useResource";

export function useSymbolInfo(symbols: string[]) {
  const key = [...symbols].sort().join(",");
  const { state, retry } = useResource<SymbolInfo[]>(`/api/symbols?s=${encodeURIComponent(key)}`, { shared: true, keepPrevious: true });
  const data = state.status === "ok" ? state.data : state.status === "loading" ? state.previous?.data : undefined;
  return useMemo(() => {
    const by = new Map((data ?? []).map((i) => [i.symbol, i]));
    return {
      state,
      retry,
      listing: (s: string): Listing | null => by.get(s)?.listing ?? null,
      splits: (data ?? []).flatMap((i) => i.splits) as Split[],
    };
  }, [data, state, retry]);
}
