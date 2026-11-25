// Where account settings live: Postgres, one row per (owner, key). Demo mode without a database
// keeps them in memory, like research notebooks. Last write wins per key.
import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { userPrefs } from "@/db/schema";
import { isDemo } from "./data";
import type { PrefKey } from "./prefs";

export type StoredPrefs = Partial<Record<PrefKey, { value: unknown; updatedAt: string }>>;

export interface PrefsStore {
  all(owner: string): Promise<StoredPrefs>;
  put(owner: string, key: PrefKey, value: unknown, now?: Date): Promise<{ updatedAt: string }>;
}

export function postgresPrefs(db: Db): PrefsStore {
  return {
    async all(owner) {
      const rows = await db.select().from(userPrefs).where(eq(userPrefs.owner, owner));
      return Object.fromEntries(rows.map((r) => [r.key, { value: r.value, updatedAt: r.updatedAt.toISOString() }]));
    },
    async put(owner, key, value, now = new Date()) {
      await db
        .insert(userPrefs)
        .values({ owner, key, value, updatedAt: now })
        .onConflictDoUpdate({ target: [userPrefs.owner, userPrefs.key], set: { value, updatedAt: now } });
      return { updatedAt: now.toISOString() };
    },
  };
}

export function memoryPrefs(): PrefsStore {
  const data = new Map<string, StoredPrefs>();
  return {
    async all(owner) {
      return structuredClone(data.get(owner) ?? {});
    },
    async put(owner, key, value, now = new Date()) {
      const mine = data.get(owner) ?? {};
      mine[key] = { value: structuredClone(value), updatedAt: now.toISOString() };
      data.set(owner, mine);
      return { updatedAt: now.toISOString() };
    },
  };
}

let demo: PrefsStore | null = null;

export function prefsStore(): PrefsStore | null {
  const db = getDb();
  if (db) return postgresPrefs(db);
  if (isDemo()) return (demo ??= memoryPrefs());
  return null;
}
