"use client";

// The user's currency against the US dollar, through the shared resource machine (one request per
// currency for every view), and the user's capital converted to dollars for sizing.
import type { Currency, FxRate } from "./money";
import type { RiskPrefs } from "./planBuilder";
import type { Resource, ViewIssue } from "./resource";
import { useResource } from "./useResource";

export const fxUrl = (c: Currency) => `/api/fx?c=${c}`;

export function useFx(currency: Currency) {
  return useResource<FxRate>(fxUrl(currency), { shared: true });
}

/** The capital in US dollars: as typed when it's in dollars, converted when the rate loaded, else unknown (with why). */
export function capitalInUsd(risk: RiskPrefs, fx: Resource<FxRate>): { usd: number | null; rate: FxRate | null; issue: ViewIssue | null; loading: boolean } {
  if (risk.account === null) return { usd: null, rate: null, issue: null, loading: false };
  if (risk.currency === "USD") return { usd: risk.account, rate: null, issue: null, loading: false };
  if (fx.status === "ok") return { usd: risk.account / fx.data.perUsd, rate: fx.data, issue: null, loading: false };
  if (fx.status === "error") return { usd: null, rate: null, issue: fx.issue, loading: false };
  return { usd: null, rate: null, issue: null, loading: true };
}
