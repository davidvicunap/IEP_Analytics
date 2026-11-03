"use client";

import { useEffect, useState } from "react";
import type { Quote } from "./types";

/** Fetches quotes for the given symbols and refreshes every 60s while the tab is visible. */
export function useQuotes(symbols: string[]) {
  const key = symbols.join(",");
  const [quotes, setQuotes] = useState<Quote[] | null>(null);

  useEffect(() => {
    if (!key) {
      setQuotes([]);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(key)}`);
        if (res.ok && alive) setQuotes(await res.json());
      } catch {
        if (alive) setQuotes((q) => q ?? []);
      }
    };
    load();
    const id = setInterval(() => document.visibilityState === "visible" && load(), 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [key]);

  return quotes;
}
