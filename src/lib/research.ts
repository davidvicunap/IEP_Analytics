// A stock's research notebook: the user's thesis, bull and bear points, fair value and plan,
// with dated notes and the history of their fair value. Pure: validation and edits live
// here (and are tested here); storage is researchStore.ts, the API is /api/research.

export type FairValueSource = "manual" | "dcf";

export type LogEntry =
  | { id: string; at: string; kind: "note"; text: string }
  /** The fair value changed: the new value (null: cleared), the price at that moment and how it was set. */
  | { id: string; at: string; kind: "fairValue"; value: number | null; price: number | null; source: FairValueSource };

export interface ResearchNote {
  symbol: string;
  thesis: string;
  bull: string; // one point per line
  bear: string;
  fairValue: number | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  log: LogEntry[]; // newest first
  updatedAt: string | null; // null: never saved
}

/** An edit. A missing field keeps its saved value, so small actions (a note, a DCF value) don't need the rest. */
export interface NoteInput {
  thesis?: string;
  bull?: string;
  bear?: string;
  fairValue?: number | null;
  fairValueSource?: FairValueSource;
  entry?: number | null;
  stop?: number | null;
  target?: number | null;
  addNote?: string;
  removeNote?: string; // id of a note entry
  price?: number | null; // the price on screen when saving, recorded with fair-value changes
  /** The `updatedAt` the edit started from; a newer saved version means someone else saved in between. */
  baseUpdatedAt: string | null;
}

export const LIMITS = { text: 4000, note: 2000, log: 200, value: 1e9 } as const;

export function emptyNote(symbol: string): ResearchNote {
  return { symbol, thesis: "", bull: "", bear: "", fairValue: null, entry: null, stop: null, target: null, log: [], updatedAt: null };
}

export type ParseError = "invalid";

/** Validates an edit from the network. Text is trimmed and capped; prices must be positive. */
export function parseInput(body: unknown): { ok: true; input: NoteInput } | { ok: false; error: ParseError } {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid" };
  const b = body as Record<string, unknown>;
  const input: NoteInput = { baseUpdatedAt: null };
  const text = (k: "thesis" | "bull" | "bear", max: number) => {
    if (b[k] === undefined) return true;
    if (typeof b[k] !== "string" || (b[k] as string).length > max) return false;
    input[k] = (b[k] as string).trim();
    return true;
  };
  const price = (k: "fairValue" | "entry" | "stop" | "target" | "price") => {
    const v = b[k];
    if (v === undefined) return true;
    if (v === null) {
      input[k] = null;
      return true;
    }
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > LIMITS.value) return false;
    input[k] = Math.round(v * 10_000) / 10_000;
    return true;
  };
  const okText = text("thesis", LIMITS.text) && text("bull", LIMITS.text) && text("bear", LIMITS.text);
  const okPrices = (["fairValue", "entry", "stop", "target", "price"] as const).every(price);
  if (!okText || !okPrices) return { ok: false, error: "invalid" };
  if (b.fairValueSource !== undefined) {
    if (b.fairValueSource !== "manual" && b.fairValueSource !== "dcf") return { ok: false, error: "invalid" };
    input.fairValueSource = b.fairValueSource;
  }
  if (b.addNote !== undefined) {
    if (typeof b.addNote !== "string" || b.addNote.length > LIMITS.note) return { ok: false, error: "invalid" };
    if (b.addNote.trim()) input.addNote = b.addNote.trim();
  }
  if (b.removeNote !== undefined) {
    if (typeof b.removeNote !== "string" || b.removeNote.length > 64) return { ok: false, error: "invalid" };
    input.removeNote = b.removeNote;
  }
  if (b.baseUpdatedAt !== undefined && b.baseUpdatedAt !== null) {
    if (typeof b.baseUpdatedAt !== "string" || Number.isNaN(Date.parse(b.baseUpdatedAt))) return { ok: false, error: "invalid" };
    input.baseUpdatedAt = new Date(b.baseUpdatedAt).toISOString();
  }
  return { ok: true, input };
}

/**
 * True when an edit of the form (thesis, points, plan) started from an older version than the
 * one saved: saving it would silently undo the other edit. Adding or removing a note and
 * setting the fair value only append or replace their own piece, so they never conflict.
 */
export function isStale(saved: ResearchNote | null, input: NoteInput): boolean {
  const touchesForm = (["thesis", "bull", "bear", "entry", "stop", "target"] as const).some((k) => input[k] !== undefined);
  if (!touchesForm) return false;
  const savedAt = saved?.updatedAt ?? null;
  return savedAt !== null && savedAt !== input.baseUpdatedAt;
}

/** The note after an edit. A changed fair value is added to the history with the price shown. */
export function applyInput(prev: ResearchNote | null, symbol: string, input: NoteInput, now: Date, newId: () => string): ResearchNote {
  const base = prev ?? emptyNote(symbol);
  const at = now.toISOString();
  const next: ResearchNote = {
    ...base,
    thesis: input.thesis ?? base.thesis,
    bull: input.bull ?? base.bull,
    bear: input.bear ?? base.bear,
    fairValue: input.fairValue !== undefined ? input.fairValue : base.fairValue,
    entry: input.entry !== undefined ? input.entry : base.entry,
    stop: input.stop !== undefined ? input.stop : base.stop,
    target: input.target !== undefined ? input.target : base.target,
    updatedAt: at,
  };
  const added: LogEntry[] = [];
  if (next.fairValue !== base.fairValue) {
    added.push({ id: newId(), at, kind: "fairValue", value: next.fairValue, price: input.price ?? null, source: input.fairValueSource ?? "manual" });
  }
  if (input.addNote) added.push({ id: newId(), at, kind: "note", text: input.addNote });
  const kept = input.removeNote ? base.log.filter((e) => !(e.kind === "note" && e.id === input.removeNote)) : base.log;
  next.log = [...added.reverse(), ...kept].slice(0, LIMITS.log);
  return next;
}

/** How far the fair value is from the price: +0.2 means the fair value is 20 % above the price. */
export function upside(fairValue: number | null, price: number | null | undefined): number | null {
  return fairValue !== null && price && price > 0 ? fairValue / price - 1 : null;
}

/** Fair-value history, oldest first (for charts and lists). */
export function fairValueHistory(note: ResearchNote): Extract<LogEntry, { kind: "fairValue" }>[] {
  return note.log.filter((e): e is Extract<LogEntry, { kind: "fairValue" }> => e.kind === "fairValue").reverse();
}
