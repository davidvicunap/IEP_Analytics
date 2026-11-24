"use client";

import type { FinancialsPayload } from "@/lib/financials";
import { useResource } from "@/lib/useResource";

/** SEC statements of `symbol`: one shared request for every view that shows them (highlights, statements, canvas windows). */
export function useFinancials(symbol: string) {
  return useResource<FinancialsPayload>(`/api/sec/financials/${encodeURIComponent(symbol)}`, { shared: true });
}
