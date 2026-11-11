// Keeps FMP's free quota (250 calls/day) for data we can actually get:
// - answers that won't change soon ("not in your plan", "not found") are remembered, so the
//   same request isn't sent again on every page view;
// - after FMP says the limit is reached, calls pause for a while instead of being refused
//   one by one (each refusal may count against the quota too);
// - prices are cached for longer when the market is closed, or when most of the day's
//   quota is gone, so new stock pages still have calls left.
// Redis is optional: without it these become no-ops and FMP is called as before.
import { getRedis } from "./redis";
import { providerCallsToday, providerDailyLimit } from "./quota";
import type { DataIssue } from "./types";

/** Issues remembered instead of retried, and for how long (seconds). */
export const REMEMBER: Partial<Record<DataIssue, number>> = {
  plan_restricted: 24 * 3600, // the plan won't change during the day
  not_found: 6 * 3600, // a new listing or a provider gap: check again later today
};

/** Pause after FMP answers "limit reached". */
export const PAUSE_SECONDS = 10 * 60;

/** Quote cache lifetimes (seconds). */
export const QUOTE_TTL = { open: 15 * 60, openTight: 60 * 60, closed: 6 * 3600 } as const;

/** Share of the daily limit after which quotes refresh hourly, to keep calls for new pages. */
export const TIGHT_SHARE = 0.8;

/**
 * Regular US trading hours: Monday–Friday 9:30–16:00 in New York. Exchange holidays aren't
 * listed: on those days quotes simply refresh more often than needed.
 */
export function isMarketOpen(now: Date = new Date()): boolean {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

export function quoteTtl(now: Date, callsToday: number | null, limit: number): number {
  if (!isMarketOpen(now)) return QUOTE_TTL.closed;
  return callsToday !== null && callsToday >= limit * TIGHT_SHARE ? QUOTE_TTL.openTight : QUOTE_TTL.open;
}

// The day's call count is read at most once a minute per server instance.
let budget: { at: number; calls: number | null } | null = null;

export async function currentQuoteTtl(now: Date = new Date()): Promise<number> {
  if (!budget || now.getTime() - budget.at > 60_000) budget = { at: now.getTime(), calls: await providerCallsToday("fmp") };
  return quoteTtl(now, budget.calls, providerDailyLimit());
}

/** Redis key for one request: path plus parameters, never the API key. */
export function rememberKey(path: string, params: Record<string, string>): string {
  const q = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return `iep:fmp:known:${path}?${q}`;
}

const PAUSE_KEY = "iep:fmp:paused";

function warn(event: string, e: unknown) {
  console.error(JSON.stringify({ event, message: e instanceof Error ? e.message : String(e) }));
}

export async function rememberedIssue(key: string): Promise<DataIssue | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const v = await redis.get<string>(key);
    return v && v in REMEMBER ? (v as DataIssue) : null;
  } catch (e) {
    warn("fmp_guard_error", e);
    return null;
  }
}

export async function rememberIssue(key: string, issue: DataIssue): Promise<void> {
  const ttl = REMEMBER[issue];
  const redis = getRedis();
  if (!ttl || !redis) return;
  try {
    await redis.set(key, issue, { ex: ttl });
  } catch (e) {
    warn("fmp_guard_error", e);
  }
}

export async function isPaused(): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    return Boolean(await redis.get(PAUSE_KEY));
  } catch (e) {
    warn("fmp_guard_error", e);
    return false;
  }
}

export async function pause(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(PAUSE_KEY, "1", { ex: PAUSE_SECONDS });
    console.warn(JSON.stringify({ event: "provider_paused", provider: "fmp", seconds: PAUSE_SECONDS }));
  } catch (e) {
    warn("fmp_guard_error", e);
  }
}
