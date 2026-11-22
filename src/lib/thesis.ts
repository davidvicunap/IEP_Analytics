// Live theses: what a research note watches and what it says today. A thesis is watched while
// it's open and has something to watch: the plan (stop, target, fair value, review date) and
// up to CHECK_LIMIT conditions the user adds (a price, a daily move, a verdict line that must
// hold, a new report, results coming). Pure: the facts are loaded in thesesData.ts.
import { VERDICT_KEYS, type VerdictKey, type VerdictLevel } from "./verdict";

export type Direction = "up" | "down";
export const CHECK_LIMIT = 8;
export const DEDUP_HOURS = 24;
export const RESULTS_DAYS = [3, 7, 14] as const;

export type CheckBody =
  | { type: "price"; op: "below" | "above"; value: number }
  /** A day's move of at least `pct` percent, either way. */
  | { type: "move"; pct: number }
  /** A line of "At a glance" that must stay at `min` or better. */
  | { type: "verdict"; area: VerdictKey; min: "good" | "mid" }
  /** A new annual or quarterly report (10-K, 10-Q, 20-F, 40-F). */
  | { type: "report" }
  /** Results expected within `days` days. */
  | { type: "results"; days: number };

export type ThesisCheck = CheckBody & { id: string; createdAt: string };
export type CheckType = CheckBody["type"];

export interface Opened {
  at: string;
  price: number | null;
}
export type Outcome = "right" | "wrong" | "mixed";
export interface Closed {
  at: string;
  price: number | null;
  outcome: Outcome;
  lesson: string;
}

/** The parts of a research note a live thesis reads. */
export interface LiveFields {
  direction: Direction;
  fairValue: number | null;
  stop: number | null;
  target: number | null;
  reviewBy: string | null; // YYYY-MM-DD
  checks: ThesisCheck[];
  closed: Closed | null;
  updatedAt: string | null;
  /** The notebook's history: the price when the fair value was set says which way it must be crossed. */
  log?: readonly { kind: string; value?: number | null; price?: number | null }[];
}

/**
 * Where the price was when the current fair value was set: "below" (the fair value was above the
 * price, so the alert is the price rising to it) or "above" (falling to it). Null when unknown.
 */
export function fairValueSide(n: Pick<LiveFields, "fairValue" | "log">): "below" | "above" | null {
  if (n.fairValue === null) return null;
  const set = n.log?.find((e) => e.kind === "fairValue" && e.value === n.fairValue);
  const p = set?.price;
  if (typeof p !== "number" || p === n.fairValue) return null;
  return p < n.fairValue ? "below" : "above";
}

/** True when the note is open and has something to watch. */
export function isWatched(n: LiveFields): boolean {
  if (!n.updatedAt || n.closed) return false;
  return n.stop !== null || n.target !== null || n.fairValue !== null || n.reviewBy !== null || n.checks.length > 0;
}

// ---- Parsing (edits from the network) -------------------------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (v: unknown): v is string => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(v));

/** A check as sent by the browser: a new one has no id. Null: not a valid check. */
export function parseCheck(raw: unknown): (CheckBody & { id?: string }) | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && /^[\w-]{1,40}$/.test(r.id) ? r.id : undefined;
  const pos = (v: unknown, max: number) => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max;
  switch (r.type) {
    case "price":
      if ((r.op !== "below" && r.op !== "above") || !pos(r.value, 1e9)) return null;
      return { id, type: "price", op: r.op, value: Math.round((r.value as number) * 10_000) / 10_000 };
    case "move":
      if (!pos(r.pct, 100)) return null;
      return { id, type: "move", pct: Math.round((r.pct as number) * 100) / 100 };
    case "verdict":
      if (!VERDICT_KEYS.includes(r.area as VerdictKey) || (r.min !== "good" && r.min !== "mid")) return null;
      return { id, type: "verdict", area: r.area as VerdictKey, min: r.min };
    case "report":
      return { id, type: "report" };
    case "results":
      if (!RESULTS_DAYS.includes(r.days as (typeof RESULTS_DAYS)[number])) return null;
      return { id, type: "results", days: r.days as number };
    default:
      return null;
  }
}

export function parseChecks(raw: unknown): (CheckBody & { id?: string })[] | null {
  if (!Array.isArray(raw) || raw.length > CHECK_LIMIT) return null;
  const out = raw.map(parseCheck);
  return out.every((c) => c !== null) ? (out as (CheckBody & { id?: string })[]) : null;
}

/** Saved checks after an edit: known ids keep their start date, new ones start now. */
export function mergeChecks(prev: ThesisCheck[], next: (CheckBody & { id?: string })[], now: string, newId: () => string): ThesisCheck[] {
  const known = new Map(prev.map((c) => [c.id, c]));
  return next.map((c) => {
    const { id, ...body } = c;
    const old = id ? known.get(id) : undefined;
    return { ...(body as CheckBody), id: old ? old.id : newId(), createdAt: old && old.type === body.type ? old.createdAt : now };
  });
}

// ---- Evaluation ------------------------------------------------------------------------------

/** What we know about the stock today. `undefined`: not asked for; `null`: asked, but unavailable. */
export interface ThesisFacts {
  price?: { value: number; changePct: number | null; at: string } | null;
  verdict?: Partial<Record<VerdictKey, VerdictLevel>> | null;
  report?: { accn: string; form: string; filed: string } | null;
  nextResults?: { date: string } | null;
}

/** `split` and `listing` aren't conditions the user sets: the data changed under the thesis. */
export type SignalKind = "stop" | "target" | "fairValue" | "reviewBy" | CheckType | "split" | "listing";
export type Tone = "risk" | "attention" | "good";

/** The figures behind an alert, shown in its sentence. */
export interface SignalData {
  price?: number;
  level?: number; // the user's threshold
  op?: "below" | "above";
  changePct?: number;
  pct?: number;
  area?: VerdictKey;
  now?: VerdictLevel;
  min?: "good" | "mid";
  form?: string;
  filed?: string;
  accn?: string;
  date?: string;
  /** split: new shares per old share; whether the note was restated. */
  ratio?: number;
  adjusted?: boolean;
  /** listing: the new ticker (absent: no longer listed). */
  to?: string;
}

export interface Signal {
  /** Stable while the same thing stays true: an alert fires once per key. */
  key: string;
  kind: SignalKind;
  tone: Tone;
  data: SignalData;
}

export const TONE: Record<SignalKind, Tone> = {
  stop: "risk",
  verdict: "risk",
  target: "good",
  fairValue: "attention",
  reviewBy: "attention",
  price: "attention",
  move: "attention",
  report: "attention",
  results: "attention",
  split: "attention",
  listing: "risk",
};

/** Which facts a note needs, so nothing is loaded (or spent) for nothing. */
export function needs(n: LiveFields): { price: boolean; verdict: boolean; filings: boolean } {
  return {
    price: n.stop !== null || n.target !== null || n.fairValue !== null || n.checks.some((c) => c.type === "price" || c.type === "move"),
    verdict: n.checks.some((c) => c.type === "verdict"),
    filings: n.checks.some((c) => c.type === "report" || c.type === "results"),
  };
}

const DAY = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);
const WORSE: Record<"good" | "mid", VerdictLevel[]> = { good: ["mid", "weak"], mid: ["weak"] };

/**
 * The alerts a watched thesis raises today, and the kinds that couldn't be checked (their
 * data was unavailable): an alert of an unchecked kind is neither raised nor cleared.
 */
export function evaluate(n: LiveFields, f: ThesisFacts, today: string): { signals: Signal[]; unchecked: SignalKind[] } {
  const signals: Signal[] = [];
  const unchecked = new Set<SignalKind>();
  if (!isWatched(n)) return { signals, unchecked: [] };
  const add = (key: string, kind: SignalKind, data: SignalData) => signals.push({ key, kind, tone: TONE[kind], data });
  const up = n.direction === "up";

  const p = f.price;
  if (p) {
    const price = p.value;
    // Keys carry the level: editing a level makes a new alert with the new figures, not a stale one.
    if (n.stop !== null && (up ? price <= n.stop : price >= n.stop)) add(`stop:${n.stop}`, "stop", { price, level: n.stop });
    if (n.target !== null && (up ? price >= n.target : price <= n.target)) add(`target:${n.target}`, "target", { price, level: n.target });
    // The fair value is crossed from the side the price was on when it was set (not judged by direction).
    const side = fairValueSide(n);
    if (n.fairValue !== null && side && (side === "below" ? price >= n.fairValue : price <= n.fairValue)) {
      add(`fairValue:${n.fairValue}`, "fairValue", { price, level: n.fairValue, op: side === "below" ? "above" : "below" });
    }
  } else if (p === null) {
    for (const k of ["stop", "target", "fairValue", "price", "move"] as const) unchecked.add(k);
  }
  if (n.reviewBy && today >= n.reviewBy) add(`reviewBy:${n.reviewBy}`, "reviewBy", { date: n.reviewBy });

  for (const c of n.checks) {
    const since = c.createdAt.slice(0, 10);
    switch (c.type) {
      case "price":
        if (p && (c.op === "below" ? p.value <= c.value : p.value >= c.value)) add(`price:${c.id}:${c.op}:${c.value}`, "price", { price: p.value, level: c.value, op: c.op });
        break;
      case "move":
        if (p && p.changePct !== null && Math.abs(p.changePct) >= c.pct) add(`move:${c.id}:${c.pct}`, "move", { price: p.value, changePct: p.changePct, pct: c.pct });
        break;
      case "verdict": {
        if (f.verdict === null) unchecked.add("verdict");
        const now = f.verdict?.[c.area];
        // Verdict in hand but no line for this area today (e.g. no valuation history): unknown, not recovered.
        if (f.verdict && !now) unchecked.add("verdict");
        if (now && WORSE[c.min].includes(now)) add(`verdict:${c.id}:${c.min}`, "verdict", { area: c.area, now, min: c.min });
        break;
      }
      case "report":
        if (f.report === null) unchecked.add("report");
        else if (f.report && f.report.filed >= since) add(`report:${c.id}:${f.report.accn}`, "report", { form: f.report.form, filed: f.report.filed, accn: f.report.accn });
        break;
      case "results": {
        if (f.nextResults === null) unchecked.add("results");
        const d = f.nextResults?.date;
        if (d && d >= today && days(today, d) <= c.days) add(`results:${c.id}:${d}`, "results", { date: d });
        break;
      }
    }
  }
  return { signals, unchecked: [...unchecked] };
}

// ---- Alerts: fire once, clear when no longer true -------------------------------------------

export interface StoredAlert {
  key: string;
  kind: SignalKind;
  tone: Tone;
  data: SignalData;
  firedAt: string;
  clearedAt: string | null;
  /** When the user marked it as seen: it leaves the home page but stays on the thesis. */
  dismissedAt?: string | null;
}

/**
 * What to record after an evaluation. A signal that isn't active fires, unless the same alert
 * fired in the last DEDUP_HOURS: then that alert is made active again without a new firing (a
 * price hovering around a level shows as one alert, not many). An active alert clears when its
 * condition no longer holds, unless its data was unavailable this time.
 */
export function reconcile(stored: StoredAlert[], signals: Signal[], unchecked: SignalKind[], now: Date): { fire: Signal[]; clear: string[]; revive: string[] } {
  const active = new Map(stored.filter((s) => s.clearedAt === null).map((s) => [s.key, s]));
  const cutoff = now.getTime() - DEDUP_HOURS * 3_600_000;
  const recent = new Set(stored.filter((s) => Date.parse(s.firedAt) > cutoff).map((s) => s.key));
  const waiting = signals.filter((s) => !active.has(s.key));
  const fire = waiting.filter((s) => !recent.has(s.key));
  const revive = waiting.filter((s) => recent.has(s.key)).map((s) => s.key);
  const live = new Set(signals.map((s) => s.key));
  const skip = new Set(unchecked);
  const clear = [...active.values()].filter((a) => !live.has(a.key) && !skip.has(a.kind)).map((a) => a.key);
  return { fire, clear, revive };
}

/** The newest stored alert for each key that `revive` names: the one to make active again. */
export function latestByKey(stored: StoredAlert[], keys: string[]): StoredAlert[] {
  const out = new Map<string, StoredAlert>();
  for (const s of stored) if (keys.includes(s.key) && (!out.has(s.key) || s.firedAt > out.get(s.key)!.firedAt)) out.set(s.key, s);
  return [...out.values()];
}

export type ThesisStatus = "onTrack" | "review" | "atRisk" | "closed" | "idle";

/** One word for the thesis: at risk (a risk alert is active), to review (any other), on track. */
export function statusOf(n: LiveFields, active: { tone: Tone }[]): ThesisStatus {
  if (n.closed) return "closed";
  if (!isWatched(n)) return "idle";
  if (active.some((a) => a.tone === "risk")) return "atRisk";
  if (active.length > 0) return "review";
  return "onTrack";
}

const RANK: Record<Tone, number> = { risk: 0, attention: 1, good: 2 };
/** Risk first, then the newest. */
export const byUrgency = <T extends { tone: Tone; firedAt: string }>(a: T, b: T) => RANK[a.tone] - RANK[b.tone] || b.firedAt.localeCompare(a.firedAt);

/** The result of a closed thesis: the price move in the expected direction (+ = it went your way). */
export function thesisReturn(direction: Direction, opened: number | null | undefined, closed: number | null | undefined): number | null {
  if (!opened || !closed || opened <= 0) return null;
  const r = closed / opened - 1;
  return direction === "up" ? r : -r;
}

// ---- Plan preview: what each level will do, in words, before saving ----------------------------

export type PreviewItem =
  | { kind: "fairValue" | "stop" | "target"; level: number; pct: number; trigger: "rises" | "falls" }
  /** The level is already on the "hit" side of the price: it would alert at once. */
  | { kind: "stop" | "target"; level: number; pct: number; trigger: "now" };

/**
 * For each level of the plan, how far it is from the price and what will raise its alert, using
 * the same rules as `evaluate` (stop and target by the expected direction, fair value by crossing
 * from where the price is now). Empty without a price.
 */
export function previewPlan(p: { direction: Direction; fairValue: number | null; stop: number | null; target: number | null }, price: number | null): PreviewItem[] {
  if (!price || price <= 0) return [];
  const out: PreviewItem[] = [];
  const pct = (v: number) => v / price - 1;
  const up = p.direction === "up";
  if (p.fairValue !== null && p.fairValue > 0 && p.fairValue !== price) out.push({ kind: "fairValue", level: p.fairValue, pct: pct(p.fairValue), trigger: p.fairValue > price ? "rises" : "falls" });
  if (p.stop !== null && p.stop > 0) {
    const ok = up ? p.stop < price : p.stop > price;
    out.push(ok ? { kind: "stop", level: p.stop, pct: pct(p.stop), trigger: up ? "falls" : "rises" } : { kind: "stop", level: p.stop, pct: pct(p.stop), trigger: "now" });
  }
  if (p.target !== null && p.target > 0) {
    const ok = up ? p.target > price : p.target < price;
    out.push(ok ? { kind: "target", level: p.target, pct: pct(p.target), trigger: up ? "rises" : "falls" } : { kind: "target", level: p.target, pct: pct(p.target), trigger: "now" });
  }
  return out;
}
