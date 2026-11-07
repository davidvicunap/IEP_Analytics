import { afterEach, describe, expect, it, vi } from "vitest";
import { databaseUrl } from "@/db/client";
import { isAuthorizedCron } from "./cron";
import { crossedThreshold, providerDailyLimit, quotaKey, recordProviderCall } from "./quota";
import { checkRateLimit, clientIp } from "./ratelimit";
import { redisConfig } from "./redis";

afterEach(() => vi.unstubAllEnvs());

describe("service configuration", () => {
  it("finds the Neon URL with or without the STORAGE_ prefix", () => {
    expect(databaseUrl({ STORAGE_DATABASE_URL: "postgres://a" })).toBe("postgres://a");
    expect(databaseUrl({ DATABASE_URL: "postgres://b" })).toBe("postgres://b");
    expect(databaseUrl({})).toBeUndefined();
  });

  it("finds Upstash credentials under the names Vercel creates", () => {
    expect(redisConfig({ KV_REST_API_URL: "https://r", KV_REST_API_TOKEN: "t" })).toEqual({ url: "https://r", token: "t" });
    expect(redisConfig({ STORAGE_KV_REST_API_URL: "https://s", STORAGE_KV_REST_API_TOKEN: "u" })).toEqual({ url: "https://s", token: "u" });
    expect(redisConfig({ UPSTASH_REDIS_REST_URL: "https://x", UPSTASH_REDIS_REST_TOKEN: "y" })).toEqual({ url: "https://x", token: "y" });
    // What the integration actually created in this project:
    expect(
      redisConfig({
        STORAGE_REDIS_KV_REST_API_URL: "https://p",
        STORAGE_REDIS_KV_REST_API_TOKEN: "rw",
        STORAGE_REDIS_KV_REST_API_READ_ONLY_TOKEN: "ro",
      }),
    ).toEqual({ url: "https://p", token: "rw" });
    // Unprefixed names win over prefixed ones.
    expect(redisConfig({ STORAGE_KV_REST_API_URL: "https://s", STORAGE_KV_REST_API_TOKEN: "u", KV_REST_API_URL: "https://r", KV_REST_API_TOKEN: "t" })).toEqual({ url: "https://r", token: "t" });
    expect(redisConfig({ KV_REST_API_URL: "https://r" })).toBeNull(); // token missing
    expect(redisConfig({ A_KV_REST_API_URL: "https://r", B_KV_REST_API_TOKEN: "t" })).toBeNull(); // prefixes differ
  });
});

describe("rate limiting", () => {
  it("takes the client IP from the first X-Forwarded-For entry", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("allows requests when Redis is not configured", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    expect(await checkRateLimit("login", "203.0.113.7")).toEqual({ ok: true });
  });
});

describe("provider quota", () => {
  it("warns once at 80 % and once at 100 % of the daily limit", () => {
    const hits = Array.from({ length: 260 }, (_, i) => crossedThreshold(i + 1, 250)).filter(Boolean);
    expect(hits).toEqual(["80%", "100%"]);
    expect(crossedThreshold(200, 250)).toBe("80%");
  });

  it("uses a per-UTC-day key and a configurable limit", () => {
    expect(quotaKey("fmp", new Date("2026-11-07T23:30:00Z"))).toBe("iep:quota:fmp:2026-11-07");
    expect(providerDailyLimit({})).toBe(250);
    expect(providerDailyLimit({ FMP_DAILY_LIMIT: "100000" })).toBe(100000);
    expect(providerDailyLimit({ FMP_DAILY_LIMIT: "nope" })).toBe(250);
  });

  it("is a no-op without Redis", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    expect(await recordProviderCall("fmp")).toBeNull();
  });
});

describe("cron authorization", () => {
  it("accepts only the exact bearer secret and fails closed without one", () => {
    expect(isAuthorizedCron("Bearer s3cret", "s3cret")).toBe(true);
    expect(isAuthorizedCron("Bearer wrong!", "s3cret")).toBe(false);
    expect(isAuthorizedCron(null, "s3cret")).toBe(false);
    expect(isAuthorizedCron("Bearer ", undefined)).toBe(false);
    expect(isAuthorizedCron("Bearer anything", "")).toBe(false);
  });
});
