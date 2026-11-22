// Where product events go: Postgres (memory in demo mode). Recording never throws into the
// request that triggered it: a failed write is logged and forgotten.
import { gte } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { events } from "@/db/schema";
import { isDemo } from "./data";
import type { EventName, EventRow } from "./funnel";

export interface EventStore {
  record(owner: string, name: EventName, props: Record<string, string | number | boolean>, at: Date): Promise<void>;
  since(at: Date): Promise<EventRow[]>;
}

export function postgresEvents(db: Db): EventStore {
  return {
    async record(owner, name, props, at) {
      await db.insert(events).values({ id: crypto.randomUUID(), owner, name, props, at });
    },
    async since(at) {
      const rows = await db.select({ owner: events.owner, name: events.name, at: events.at }).from(events).where(gte(events.at, at));
      return rows.map((r) => ({ owner: r.owner, name: r.name as EventName, at: r.at.toISOString() }));
    },
  };
}

export function memoryEvents(): EventStore {
  const rows: EventRow[] = [];
  return {
    async record(owner, name, _props, at) {
      rows.push({ owner, name, at: at.toISOString() });
    },
    async since(at) {
      return rows.filter((r) => Date.parse(r.at) >= at.getTime());
    },
  };
}

// One demo store per process: the /stats page and the API routes are separate bundles in Next,
// so a module-level variable would give each its own (empty) copy.
const shared = globalThis as typeof globalThis & { __iepDemoEvents?: EventStore };
export function eventStore(): EventStore | null {
  const db = getDb();
  if (db) return postgresEvents(db);
  if (isDemo()) return (shared.__iepDemoEvents ??= memoryEvents());
  return null;
}

export async function recordEvent(owner: string, name: EventName, props: Record<string, string | number | boolean> = {}, at = new Date()): Promise<void> {
  try {
    await eventStore()?.record(owner, name, props, at);
  } catch (e) {
    console.warn(JSON.stringify({ event: "event_record_error", name, message: e instanceof Error ? e.message : String(e) }));
  }
}
