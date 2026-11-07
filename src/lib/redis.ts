// Upstash Redis (REST): rate limits and usage counters. Optional: everything degrades to a
// no-op when it is not configured, so the app never breaks because Redis is missing.
import { Redis } from "@upstash/redis";

type Env = Record<string, string | undefined>;

/** Accepts the names the Vercel–Upstash integration creates, with or without the STORAGE_ prefix. */
export function redisConfig(env: Env = process.env): { url: string; token: string } | null {
  for (const p of ["", "STORAGE_"]) {
    const url = env[`${p}KV_REST_API_URL`] || env[`${p}UPSTASH_REDIS_REST_URL`];
    const token = env[`${p}KV_REST_API_TOKEN`] || env[`${p}UPSTASH_REDIS_REST_TOKEN`];
    if (url && token) return { url, token };
  }
  return null;
}

let client: Redis | null = null;

export function getRedis(): Redis | null {
  const config = redisConfig();
  if (!config) return null;
  client ??= new Redis({ url: config.url, token: config.token, retry: { retries: 1 } });
  return client;
}
