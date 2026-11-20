// Where live-thesis alerts are kept: Postgres, one row per firing, keyed by owner and symbol.
// Demo mode without a database keeps them in memory, like the research notebooks.
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { thesisAlerts } from "@/db/schema";
import { isDemo } from "./data";
import type { Signal, SignalData, SignalKind, StoredAlert, Tone } from "./thesis";

export interface AlertStore {
  /** Active alerts plus any fired since `since` (for de-duplication). */
  recent(owner: string, symbol: string, since: Date): Promise<StoredAlert[]>;
  /** Records new alerts, clears the ones no longer true and makes `revive` (alerts by firing time) active again. */
  apply(owner: string, symbol: string, fire: Signal[], clear: string[], now: Date, revive?: StoredAlert[]): Promise<void>;
  /** Forgets every alert of a stock (its notebook was deleted). */
  remove(owner: string, symbol: string): Promise<void>;
  /** The newest alerts for a stock, active or cleared. */
  history(owner: string, symbol: string, limit: number): Promise<StoredAlert[]>;
}

type Row = typeof thesisAlerts.$inferSelect;
const fromRow = (r: Row): StoredAlert => ({
  key: r.key,
  kind: r.kind as SignalKind,
  tone: r.tone as Tone,
  data: r.data as SignalData,
  firedAt: r.firedAt.toISOString(),
  clearedAt: r.clearedAt ? r.clearedAt.toISOString() : null,
});

export function postgresAlerts(db: Db): AlertStore {
  const mine = (owner: string, symbol: string) => and(eq(thesisAlerts.owner, owner), eq(thesisAlerts.symbol, symbol));
  return {
    async recent(owner, symbol, since) {
      const rows = await db
        .select()
        .from(thesisAlerts)
        .where(and(mine(owner, symbol), or(isNull(thesisAlerts.clearedAt), gt(thesisAlerts.firedAt, since))));
      return rows.map(fromRow);
    },
    async apply(owner, symbol, fire, clear, now, revive = []) {
      for (const r of revive) {
        await db
          .update(thesisAlerts)
          .set({ clearedAt: null })
          .where(and(mine(owner, symbol), eq(thesisAlerts.key, r.key), eq(thesisAlerts.firedAt, new Date(r.firedAt))));
      }
      if (fire.length) {
        await db
          .insert(thesisAlerts)
          .values(fire.map((s) => ({ owner, symbol, key: s.key, kind: s.kind, tone: s.tone, data: s.data, firedAt: now })))
          .onConflictDoNothing();
      }
      for (const key of clear) {
        await db
          .update(thesisAlerts)
          .set({ clearedAt: now })
          .where(and(mine(owner, symbol), eq(thesisAlerts.key, key), isNull(thesisAlerts.clearedAt)));
      }
    },
    async remove(owner, symbol) {
      await db.delete(thesisAlerts).where(mine(owner, symbol));
    },
    async history(owner, symbol, limit) {
      const rows = await db.select().from(thesisAlerts).where(mine(owner, symbol)).orderBy(desc(thesisAlerts.firedAt)).limit(limit);
      return rows.map(fromRow);
    },
  };
}

/** In-memory alerts for demo mode (lost on restart; never used with a real database). */
export function memoryAlerts(): AlertStore {
  const rows = new Map<string, StoredAlert[]>();
  const at = (owner: string, symbol: string) => {
    const k = `${owner}\u0000${symbol}`;
    if (!rows.has(k)) rows.set(k, []);
    return rows.get(k)!;
  };
  return {
    async recent(owner, symbol, since) {
      return at(owner, symbol).filter((a) => a.clearedAt === null || Date.parse(a.firedAt) > since.getTime());
    },
    async apply(owner, symbol, fire, clear, now, revive = []) {
      const list = at(owner, symbol);
      const t = now.toISOString();
      for (const a of list) if (revive.some((r) => r.key === a.key && r.firedAt === a.firedAt)) a.clearedAt = null;
      for (const s of fire) list.push({ key: s.key, kind: s.kind, tone: s.tone, data: s.data, firedAt: t, clearedAt: null });
      for (const a of list) if (a.clearedAt === null && clear.includes(a.key)) a.clearedAt = t;
    },
    async remove(owner, symbol) {
      rows.delete(`${owner}\u0000${symbol}`);
    },
    async history(owner, symbol, limit) {
      return [...at(owner, symbol)].sort((a, b) => b.firedAt.localeCompare(a.firedAt)).slice(0, limit);
    },
  };
}

let demo: AlertStore | null = null;

/** Postgres when configured; in demo mode without a database, in memory. */
export function alertStore(): AlertStore | null {
  const db = getDb();
  if (db) return postgresAlerts(db);
  if (isDemo()) return (demo ??= memoryAlerts());
  return null;
}
