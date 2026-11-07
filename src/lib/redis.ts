// Upstash Redis (REST): rate limits and usage counters. Optional: everything degrades to a
// no-op when it is not configured, so the app never breaks because Redis is missing.
import { Redis } from "@upstash/redis";

type Env = Record<string, string | undefined>;

const URL_TO_TOKEN: [string, string][] = [
  ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
  ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
];

/**
 * Finds the Upstash REST credentials the Vercel integration creates, whatever prefix was
 * chosen when connecting (none, STORAGE_, STORAGE_REDIS_…). URL and token must share it.
 * Unprefixed names win; the read-only token is never used.
 */
export function redisConfig(env: Env = process.env): { url: string; token: string } | null {
  const candidates: { prefix: string; url: string; token: string }[] = [];
  for (const [key, url] of Object.entries(env)) {
    if (!url) continue;
    for (const [urlName, tokenName] of URL_TO_TOKEN) {
      if (!key.endsWith(urlName)) continue;
      const prefix = key.slice(0, key.length - urlName.length);
      const token = env[`${prefix}${tokenName}`];
      if (token) candidates.push({ prefix, url, token });
    }
  }
  candidates.sort((a, b) => a.prefix.length - b.prefix.length || a.prefix.localeCompare(b.prefix));
  const best = candidates[0];
  return best ? { url: best.url, token: best.token } : null;
}

let client: Redis | null = null;

export function getRedis(): Redis | null {
  const config = redisConfig();
  if (!config) return null;
  client ??= new Redis({ url: config.url, token: config.token, retry: { retries: 1 } });
  return client;
}
