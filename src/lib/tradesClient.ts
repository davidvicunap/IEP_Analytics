"use client";

// Browser side of your trades: the list through the shared resource machine (one request for
// every view that shows it), logging and deleting trades. After a change every view reads the
// list again.
import { useEffect } from "react";
import type { Trade, TradeInput } from "./trades";
import { sharedLoader, toViewResult, type ViewIssue } from "./resource";
import { useResource } from "./useResource";

export const TRADES_URL = "/api/trades";

const listeners = new Set<() => void>();
function changed() {
  sharedLoader.forget(TRADES_URL);
  for (const l of listeners) l();
}

export function useTrades() {
  const r = useResource<Trade[]>(TRADES_URL, { shared: true, keepPrevious: true });
  const { retry } = r;
  useEffect(() => {
    listeners.add(retry);
    return () => {
      listeners.delete(retry);
    };
  }, [retry]);
  return r;
}

/** Why a trade wasn't saved or deleted: the record would sell shares never bought, bad input, or the usual reasons. */
export type TradeIssue = ViewIssue | "oversold" | "invalid";

async function call<T>(url: string, method: "POST" | "DELETE", body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: TradeIssue }> {
  let res: Response;
  try {
    res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    return { ok: false, error: "upstream" };
  }
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  if (res.status === 409 && json?.error === "oversold") return { ok: false, error: "oversold" };
  if (res.status === 400) return { ok: false, error: "invalid" };
  const r = toViewResult<T>(res.status, json);
  if (!r.ok) return { ok: false, error: r.error };
  changed();
  return { ok: true, data: r.data };
}

export const addTrade = (symbol: string, input: TradeInput) => call<Trade>(TRADES_URL, "POST", { symbol, ...input });
export const removeTrade = (id: string) => call<{ id: string }>(`${TRADES_URL}/${encodeURIComponent(id)}`, "DELETE");
