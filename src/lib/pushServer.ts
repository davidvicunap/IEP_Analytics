// Phone alerts, server side: where subscriptions are kept (Postgres, or memory in demo mode),
// the VAPID key pair that signs every push (env vars, else created once and kept in the
// database) and sending to every device of one beta label. A device whose subscription the push
// service says is gone (404/410) is forgotten; other failures are logged and never break a check.
import { eq } from "drizzle-orm";
import webpush from "web-push";
import { getDb, type Db } from "@/db/client";
import { pushKeys, pushSubscriptions } from "@/db/schema";
import { isDemo } from "./data";
import type { Lang } from "./format";
import en from "./i18n/en";
import es from "./i18n/es";
import type { CoreDict } from "./i18n/es";
import type { PushMessage, PushSub } from "./push";

export interface StoredSub extends PushSub {
  lang: Lang;
}
export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

export interface PushStore {
  /** Saves (or moves to this owner, with this language) one browser's subscription. */
  save(owner: string, sub: PushSub, lang: Lang, now: Date): Promise<void>;
  /** False when this owner had no such subscription. */
  remove(owner: string, endpoint: string): Promise<boolean>;
  /** The push service said this browser is gone. */
  forget(endpoint: string): Promise<void>;
  list(owner: string): Promise<StoredSub[]>;
  sent(endpoint: string, now: Date): Promise<void>;
  /** The stored key pair, created with `make` the first time (the first writer wins). */
  keys(make: () => KeyPair): Promise<KeyPair>;
}

export function postgresPush(db: Db): PushStore {
  return {
    async save(owner, sub, lang, now) {
      await db
        .insert(pushSubscriptions)
        .values({ endpoint: sub.endpoint, owner, p256dh: sub.keys.p256dh, auth: sub.keys.auth, lang, createdAt: now })
        .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { owner, p256dh: sub.keys.p256dh, auth: sub.keys.auth, lang } });
    },
    async remove(owner, endpoint) {
      const rows = await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).returning({ owner: pushSubscriptions.owner });
      return rows.some((r) => r.owner === owner);
    },
    async forget(endpoint) {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    },
    async list(owner) {
      const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.owner, owner));
      return rows.map((r) => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth }, lang: r.lang === "en" ? "en" : "es" }));
    },
    async sent(endpoint, now) {
      await db.update(pushSubscriptions).set({ lastSentAt: now }).where(eq(pushSubscriptions.endpoint, endpoint));
    },
    async keys(make) {
      const [row] = await db.select().from(pushKeys).where(eq(pushKeys.id, 1)).limit(1);
      if (row) return { publicKey: row.publicKey, privateKey: row.privateKey };
      const k = make();
      await db.insert(pushKeys).values({ id: 1, publicKey: k.publicKey, privateKey: k.privateKey }).onConflictDoNothing();
      // Another instance may have written first: everyone uses the stored pair.
      const [stored] = await db.select().from(pushKeys).where(eq(pushKeys.id, 1)).limit(1);
      return stored ? { publicKey: stored.publicKey, privateKey: stored.privateKey } : k;
    },
  };
}

/** In memory, for demo mode without a database (lost on restart). */
export function memoryPush(): PushStore {
  const subs = new Map<string, StoredSub & { owner: string }>();
  let pair: KeyPair | null = null;
  return {
    async save(owner, sub, lang) {
      subs.set(sub.endpoint, { ...sub, owner, lang });
    },
    async remove(owner, endpoint) {
      const s = subs.get(endpoint);
      if (!s || s.owner !== owner) return false;
      subs.delete(endpoint);
      return true;
    },
    async forget(endpoint) {
      subs.delete(endpoint);
    },
    async list(owner) {
      return [...subs.values()].filter((s) => s.owner === owner).map(({ endpoint, keys, lang }) => ({ endpoint, keys, lang }));
    },
    async sent() {},
    async keys(make) {
      return (pair ??= make());
    },
  };
}

let demo: PushStore | null = null;
export function pushStore(): PushStore | null {
  const db = getDb();
  if (db) return postgresPush(db);
  if (isDemo()) return (demo ??= memoryPush());
  return null;
}

/** The key pair: VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY when both are set, else the stored one. */
export async function vapidKeys(store: PushStore): Promise<KeyPair> {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (publicKey && privateKey) return { publicKey, privateKey };
  return store.keys(() => webpush.generateVAPIDKeys());
}

/** Who to contact about this server's pushes (required by push services): a mailto: or https URL. */
const subject = () => process.env.VAPID_SUBJECT?.trim() || "https://iepanalytics.vercel.app";

/** Sends one payload; the push service's HTTP status (0: it couldn't be reached). */
export type Sender = (sub: PushSub, payload: string, keys: KeyPair) => Promise<number>;

export const webPushSender: Sender = async (sub, payload, keys) => {
  try {
    const r = await webpush.sendNotification(sub, payload, {
      vapidDetails: { subject: subject(), publicKey: keys.publicKey, privateKey: keys.privateKey },
      TTL: 24 * 3600, // an alert a day late is still worth seeing; older isn't
      urgency: "high",
    });
    return r.statusCode;
  } catch (e) {
    return typeof (e as { statusCode?: unknown }).statusCode === "number" ? (e as { statusCode: number }).statusCode : 0;
  }
};

export const dictFor = (lang: Lang): CoreDict => (lang === "en" ? en : es);

export interface SendResult {
  devices: number;
  sent: number;
  failed: number;
  gone: number;
}

/** Sends `build(lang)` to every device of `owner`, in each device's language. */
export async function sendToOwner(owner: string, build: (t: CoreDict, lang: Lang) => PushMessage[], deps: { store: PushStore; sender?: Sender; now?: Date }): Promise<SendResult> {
  const { store, sender = webPushSender, now = new Date() } = deps;
  const devices = await store.list(owner);
  const out: SendResult = { devices: devices.length, sent: 0, failed: 0, gone: 0 };
  if (!devices.length) return out;
  const keys = await vapidKeys(store);
  for (const d of devices) {
    let delivered = false;
    for (const m of build(dictFor(d.lang), d.lang)) {
      const status = await sender(d, JSON.stringify(m), keys);
      if (status === 404 || status === 410) {
        await store.forget(d.endpoint);
        out.gone++;
        break;
      }
      if (status >= 200 && status < 300) {
        out.sent++;
        delivered = true;
      } else {
        out.failed++;
        console.warn(JSON.stringify({ event: "push_failed", status }));
      }
    }
    if (delivered) await store.sent(d.endpoint, now);
  }
  return out;
}
