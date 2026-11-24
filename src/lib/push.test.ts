import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Db } from "@/db/client";
import en from "./i18n/en";
import es from "./i18n/es";
import { MAX_STOCK_NOTIFICATIONS, alertMessages, parseSubscription, testMessage, type PushSub } from "./push";
import { memoryPush, postgresPush, sendToOwner, vapidKeys, type PushStore, type Sender } from "./pushServer";
import type { Signal } from "./thesis";
import { notifyFired, recordingFires } from "./thesisNotify";
import { memoryAlerts } from "./thesisAlertStore";

const sub = (n: number): PushSub => ({
  endpoint: `https://push.example.com/send/${n}`,
  keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
});
const stop: Signal = { key: "stop:150", kind: "stop", tone: "risk", data: { level: 150, price: 148.5 } };
const target: Signal = { key: "target:320", kind: "target", tone: "good", data: { level: 320, price: 321 } };

describe("subscriptions from the browser", () => {
  it("accepts an https endpoint with its two keys and nothing else", () => {
    expect(parseSubscription({ ...sub(1), expirationTime: null })).toEqual(sub(1));
    expect(parseSubscription({ ...sub(1), endpoint: "http://push.example.com/x" })).toBeNull();
    expect(parseSubscription({ ...sub(1), endpoint: "not a url" })).toBeNull();
    expect(parseSubscription({ endpoint: sub(1).endpoint, keys: { p256dh: "short", auth: "a".repeat(22) } })).toBeNull();
    expect(parseSubscription({ endpoint: sub(1).endpoint, keys: { p256dh: "B".repeat(87), auth: "bad key!" } })).toBeNull();
    expect(parseSubscription(null)).toBeNull();
  });
});

describe("notification text", () => {
  it("one per stock, in the device's language, opening that thesis", () => {
    const [m] = alertMessages([{ symbol: "AAPL", alerts: [stop] }], es, "es");
    expect(m).toEqual({ title: "AAPL: aviso de tu tesis", body: expect.stringContaining("$150.00"), url: "/stock/AAPL?tab=research", tag: "thesis-AAPL" });
    const [both] = alertMessages([{ symbol: "AAPL", alerts: [stop, target] }], en, "en");
    expect(both.title).toBe("AAPL: 2 thesis alerts");
    expect(both.body.split("\n")).toHaveLength(2);
  });

  it("many stocks at once: one summary that opens the list", () => {
    const many = Array.from({ length: MAX_STOCK_NOTIFICATIONS + 1 }, (_, i) => ({ symbol: `S${i}`, alerts: [stop] }));
    expect(alertMessages(many, en, "en")).toEqual([{ title: "4 theses with new alerts", body: "S0 · S1 · S2 · S3", url: "/", tag: "theses" }]);
    expect(alertMessages([{ symbol: "X", alerts: [] }], en, "en")).toEqual([]);
    expect(testMessage(es).url).toBe("/");
  });
});

let pg: Db;
beforeAll(async () => {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  pg = db as unknown as Db;
});

describe.each([
  ["Postgres (real migration on PGlite)", () => postgresPush(pg)],
  ["memory (demo)", () => memoryPush()],
])("push store: %s", (_name, make: () => PushStore) => {
  it("keeps one row per browser, moves it to whoever subscribes it last, and forgets it", async () => {
    const s = make();
    const now = new Date("2026-11-21T15:00:00Z");
    await s.save("ana", sub(1), "es", now);
    await s.save("ana", sub(1), "en", now); // the same browser again: updated, not duplicated
    await s.save("ana", sub(2), "es", now);
    await s.save("luis", sub(3), "es", now);
    expect((await s.list("ana")).map((d) => [d.endpoint, d.lang])).toEqual([
      [sub(1).endpoint, "en"],
      [sub(2).endpoint, "es"],
    ]);
    expect(await s.remove("luis", sub(1).endpoint)).toBe(false); // not his
    expect(await s.remove("ana", sub(2).endpoint)).toBe(true);
    await s.forget(sub(1).endpoint);
    expect(await s.list("ana")).toEqual([]);
    expect(await s.list("luis")).toHaveLength(1);
  });

  it("creates the key pair once and then always returns it", async () => {
    const s = make();
    const make1 = vi.fn(() => ({ publicKey: "pub-1", privateKey: "priv-1" }));
    const first = await s.keys(make1);
    const again = await s.keys(() => ({ publicKey: "pub-2", privateKey: "priv-2" }));
    expect(again).toEqual(first);
    expect(make1).toHaveBeenCalledTimes(1);
  });
});

describe("sending", () => {
  it("uses VAPID keys from the environment when both are set", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "env-pub");
    vi.stubEnv("VAPID_PRIVATE_KEY", "env-priv");
    expect(await vapidKeys(memoryPush())).toEqual({ publicKey: "env-pub", privateKey: "env-priv" });
    vi.unstubAllEnvs();
    const generated = await vapidKeys(memoryPush());
    expect(generated.publicKey.length).toBeGreaterThan(40);
  });

  it("sends to every device in its language; a device the push service no longer knows is forgotten", async () => {
    const store = memoryPush();
    const now = new Date();
    await store.save("ana", sub(1), "es", now);
    await store.save("ana", sub(2), "en", now);
    await store.save("ana", sub(3), "es", now);
    const payloads: Record<string, string> = {};
    const sender: Sender = async (s, payload) => {
      payloads[s.endpoint] = payload;
      return s.endpoint.endsWith("/2") ? 410 : s.endpoint.endsWith("/3") ? 500 : 201;
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await sendToOwner("ana", (t) => [testMessage(t)], { store, sender });
    warn.mockRestore();
    expect(r).toEqual({ devices: 3, sent: 1, failed: 1, gone: 1 });
    expect(JSON.parse(payloads[sub(1).endpoint]).body).toBe(es.push.msgTestBody);
    expect(JSON.parse(payloads[sub(2).endpoint]).body).toBe(en.push.msgTestBody);
    expect((await store.list("ana")).map((d) => d.endpoint)).toEqual([sub(1).endpoint, sub(3).endpoint]);
  });
});

describe("alerts that fire reach the phone", () => {
  it("records only new firings during a check, then sends one notification per stock", async () => {
    const { alerts, fired } = recordingFires(memoryAlerts());
    const now = new Date("2026-11-21T15:00:00Z");
    await alerts.apply("ana", "AAPL", [stop], [], now);
    await alerts.apply("ana", "MSFT", [], ["target:1"], now); // a clear: nothing to send
    await alerts.apply("ana", "AAPL", [target], [], now);
    expect([...fired.get("ana")!.keys()]).toEqual(["AAPL"]);
    expect(fired.get("ana")!.get("AAPL")!.map((s) => s.key)).toEqual(["stop:150", "target:320"]);
    expect((await alerts.recent("ana", "AAPL", new Date(0))).length).toBe(2); // still recorded

    const store = memoryPush();
    await store.save("ana", sub(1), "en", now);
    const sent: string[] = [];
    const summary = await notifyFired(fired, { store, sender: async (_s, p) => (sent.push(JSON.parse(p).title), 201), now });
    expect(summary).toEqual({ owners: 1, sent: 1, failed: 0, gone: 0 });
    expect(sent).toEqual(["AAPL: 2 thesis alerts"]);
  });

  it("never throws: a broken push store is logged and the check goes on", async () => {
    const fired = new Map([["ana", new Map([["AAPL", [stop]]])]]);
    const broken = { ...memoryPush(), list: async () => Promise.reject(new Error("db down")) };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await notifyFired(fired, { store: broken })).toMatchObject({ failed: 1, sent: 0 });
    error.mockRestore();
    expect(await notifyFired(new Map(), { store: null })).toEqual({ owners: 0, sent: 0, failed: 0, gone: 0 });
  });
});
