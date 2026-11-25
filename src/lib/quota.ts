// Daily count of real (uncached) calls to each data provider, to see quota use before
// the provider starts refusing requests. Counts by UTC day; a no-op without Redis.
import { getRedis } from "./redis";

export type Provider = "fmp" | "claude";

export function providerDailyLimit(env: Record<string, string | undefined> = process.env, provider: Provider = "fmp"): number {
  if (provider === "claude") {
    // AI explanations: a spending cap, not a provider limit (each one costs a few cents).
    const c = Number(env.CLAUDE_DAILY_LIMIT);
    return Number.isFinite(c) && c >= 0 && env.CLAUDE_DAILY_LIMIT !== undefined && env.CLAUDE_DAILY_LIMIT !== "" ? c : 40;
  }
  const n = Number(env.FMP_DAILY_LIMIT);
  return Number.isFinite(n) && n > 0 ? n : 250; // FMP Basic (free) plan
}

export function quotaKey(provider: Provider, date = new Date()): string {
  return `iep:quota:${provider}:${date.toISOString().slice(0, 10)}`;
}

/** Thresholds that log a warning exactly once per day: 80 % and 100 % of the limit. */
export function crossedThreshold(calls: number, limit: number): "80%" | "100%" | null {
  if (calls === limit) return "100%";
  if (calls === Math.ceil(limit * 0.8)) return "80%";
  return null;
}

/** Per-endpoint counts for the day (a hash: endpoint path → calls), to see where the quota goes. */
export function endpointsKey(provider: Provider, date = new Date()): string {
  return `iep:quota:${provider}:endpoints:${date.toISOString().slice(0, 10)}`;
}

const KEEP_SECONDS = 3 * 24 * 60 * 60;

/**
 * Counts one real call, and under which endpoint (the API path, e.g. "quote" or "batch-quote":
 * never its parameters, so no tickers are stored).
 */
export async function recordProviderCall(provider: Provider, endpoint?: string): Promise<number | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const key = quotaKey(provider);
    const calls = await redis.incr(key);
    if (calls === 1) await redis.expire(key, KEEP_SECONDS);
    if (endpoint) {
      const ek = endpointsKey(provider);
      if ((await redis.hincrby(ek, endpoint, 1)) === 1) await redis.expire(ek, KEEP_SECONDS);
    }
    const limit = providerDailyLimit(process.env, provider);
    const threshold = crossedThreshold(calls, limit);
    if (threshold) console.warn(JSON.stringify({ event: "provider_quota_warning", provider, calls, limit, threshold }));
    return calls;
  } catch (e) {
    console.error(JSON.stringify({ event: "quota_error", provider, message: e instanceof Error ? e.message : String(e) }));
    return null;
  }
}

export async function providerCallsToday(provider: Provider): Promise<number | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return Number((await redis.get<number>(quotaKey(provider))) ?? 0);
  } catch {
    return null;
  }
}

export interface ProviderUsage {
  calls: number;
  limit: number;
  /** Most-used first. */
  byEndpoint: { endpoint: string; calls: number }[];
}

/** Today's use of a provider (UTC day), or null without Redis or when it can't be read. */
export async function providerUsageToday(provider: Provider): Promise<ProviderUsage | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const [calls, hash] = await Promise.all([redis.get<number>(quotaKey(provider)), redis.hgetall<Record<string, number>>(endpointsKey(provider))]);
    return { calls: Number(calls ?? 0), limit: providerDailyLimit(process.env, provider), byEndpoint: sortUsage(hash ?? {}) };
  } catch {
    return null;
  }
}

export function sortUsage(hash: Record<string, number | string>): ProviderUsage["byEndpoint"] {
  return Object.entries(hash)
    .map(([endpoint, n]) => ({ endpoint, calls: Number(n) }))
    .filter((e) => Number.isFinite(e.calls) && e.calls > 0)
    .sort((a, b) => b.calls - a.calls || a.endpoint.localeCompare(b.endpoint));
}
