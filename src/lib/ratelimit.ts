import { Ratelimit } from "@upstash/ratelimit";
import { getRedis } from "./redis";

export type LimitKind = "api" | "login";

/** Requests allowed per client IP and window. */
export const LIMITS: Record<LimitKind, { requests: number; window: `${number} m` }> = {
  api: { requests: 120, window: "1 m" },
  login: { requests: 10, window: "10 m" }, // invite-code attempts
};

const limiters = new Map<LimitKind, Ratelimit>();

export type LimitResult = { ok: true } | { ok: false; retryAfter: number };

/** Fails open: if Redis is missing or down, requests are allowed and the error is logged. */
export async function checkRateLimit(kind: LimitKind, id: string): Promise<LimitResult> {
  const redis = getRedis();
  if (!redis) return { ok: true };
  let limiter = limiters.get(kind);
  if (!limiter) {
    const { requests, window } = LIMITS[kind];
    limiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(requests, window), prefix: `iep:rl:${kind}` });
    limiters.set(kind, limiter);
  }
  try {
    const r = await limiter.limit(id);
    return r.success ? { ok: true } : { ok: false, retryAfter: Math.max(1, Math.ceil((r.reset - Date.now()) / 1000)) };
  } catch (e) {
    console.error(JSON.stringify({ event: "ratelimit_error", kind, message: e instanceof Error ? e.message : String(e) }));
    return { ok: true };
  }
}

/** First address in X-Forwarded-For (set by Vercel), then X-Real-IP. */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "unknown";
}
