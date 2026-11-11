// Where research notebooks live: Postgres, keyed by owner (the beta invite label) and symbol.
// Demo mode without a database keeps them in memory, so the feature can be tried locally.
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { researchNotes } from "@/db/schema";
import { applyInput, isStale, type LogEntry, type NoteInput, type ResearchNote } from "./research";

export interface ResearchStore {
  get(owner: string, symbol: string): Promise<ResearchNote | null>;
  list(owner: string): Promise<ResearchNote[]>;
  /** Applies an edit. `conflict`: someone saved a newer version since `baseUpdatedAt`. */
  save(owner: string, symbol: string, input: NoteInput, now?: Date): Promise<{ ok: true; note: ResearchNote } | { ok: false; error: "conflict" }>;
  remove(owner: string, symbol: string): Promise<void>;
}

const newId = () => crypto.randomUUID().slice(0, 12);

type Row = typeof researchNotes.$inferSelect;
function fromRow(r: Row): ResearchNote {
  return {
    symbol: r.symbol,
    thesis: r.thesis,
    bull: r.bull,
    bear: r.bear,
    fairValue: r.fairValue,
    entry: r.entry,
    stop: r.stop,
    target: r.target,
    log: Array.isArray(r.log) ? (r.log as LogEntry[]) : [],
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function postgresStore(db: Db): ResearchStore {
  const where = (owner: string, symbol: string) => and(eq(researchNotes.owner, owner), eq(researchNotes.symbol, symbol));
  const get = async (owner: string, symbol: string) => {
    const [row] = await db.select().from(researchNotes).where(where(owner, symbol)).limit(1);
    return row ? fromRow(row) : null;
  };
  return {
    get,
    async list(owner) {
      const rows = await db.select().from(researchNotes).where(eq(researchNotes.owner, owner)).orderBy(desc(researchNotes.updatedAt));
      return rows.map(fromRow);
    },
    async save(owner, symbol, input, now = new Date()) {
      const prev = await get(owner, symbol);
      if (isStale(prev, input)) return { ok: false, error: "conflict" };
      const note = applyInput(prev, symbol, input, now, newId);
      const values = {
        owner,
        symbol,
        thesis: note.thesis,
        bull: note.bull,
        bear: note.bear,
        fairValue: note.fairValue,
        entry: note.entry,
        stop: note.stop,
        target: note.target,
        log: note.log,
        updatedAt: now,
      };
      if (prev) {
        // Only if nobody saved in between (compare-and-set on updatedAt).
        const updated = await db
          .update(researchNotes)
          .set(values)
          .where(and(where(owner, symbol), eq(researchNotes.updatedAt, new Date(prev.updatedAt!))))
          .returning({ symbol: researchNotes.symbol });
        if (updated.length === 0) return { ok: false, error: "conflict" };
      } else {
        const inserted = await db.insert(researchNotes).values(values).onConflictDoNothing().returning({ symbol: researchNotes.symbol });
        if (inserted.length === 0) return { ok: false, error: "conflict" };
      }
      return { ok: true, note };
    },
    async remove(owner, symbol) {
      await db.delete(researchNotes).where(where(owner, symbol));
    },
  };
}

/** In-memory store for demo mode (lost on restart; never used with a real database). */
export function memoryStore(): ResearchStore {
  const notes = new Map<string, ResearchNote>();
  const key = (owner: string, symbol: string) => `${owner}\u0000${symbol}`;
  return {
    async get(owner, symbol) {
      return notes.get(key(owner, symbol)) ?? null;
    },
    async list(owner) {
      return [...notes.entries()]
        .filter(([k]) => k.startsWith(`${owner}\u0000`))
        .map(([, n]) => n)
        .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    },
    async save(owner, symbol, input, now = new Date()) {
      const prev = notes.get(key(owner, symbol)) ?? null;
      if (isStale(prev, input)) return { ok: false, error: "conflict" };
      const note = applyInput(prev, symbol, input, now, newId);
      notes.set(key(owner, symbol), note);
      return { ok: true, note };
    },
    async remove(owner, symbol) {
      notes.delete(key(owner, symbol));
    },
  };
}
