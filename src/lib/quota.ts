// Daily count of real (uncached) calls to each data provider, to see quota use before
// the provider starts refusing requests. Counts by UTC day; a no-op without Redis.
import { getRedis } from "./redis";

export type Provider = "fmp";

export function providerDailyLimit(env: Record<string, string | undefined> = process.env): number {
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

export async function recordProviderCall(provider: Provider): Promise<number | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const key = quotaKey(provider);
    const calls = await redis.incr(key);
    if (calls === 1) await redis.expire(key, 3 * 24 * 60 * 60);
    const limit = providerDailyLimit();
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
