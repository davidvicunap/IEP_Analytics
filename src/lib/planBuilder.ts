// The guided plan: from the stock's own data to a plan in three steps (why, what would change
// your mind, how much to risk). Pure: the suggestions are arithmetic on data the app already
// has (key levels from the price history, the fair value, the next results date), each with the
// reason it was suggested, and the position size is a calculation the user can check by hand.
// Nothing here says to buy or sell; the user picks or types every level.
import type { KeyLevels } from "./levels";
import type { Direction } from "./thesis";
import type { VerdictPoint } from "./verdict";

/** Why a level was suggested, in data the page turns into words. */
export type LevelBasis =
  | { kind: "zone"; side: "support" | "resistance"; price: number; touches: number }
  | { kind: "atr"; atr: number; multiple: number }
  | { kind: "high52" | "low52"; price: number }
  | { kind: "fairValue"; price: number };

export interface LevelOption {
  level: number;
  basis: LevelBasis;
  /** Distance from the entry, as a fraction (−0.06 = 6 % below). */
  pct: number;
}

/** Levels further than this from the entry aren't suggested (they'd be a different plan). */
export const MAX_DISTANCE = 0.5;
export const ATR_MULTIPLE = 2;
export const MAX_OPTIONS = 3;

const cents = (v: number) => Math.round(v * 100) / 100;
const ref = (levels: KeyLevels, key: "high52" | "low52") => levels.references.find((r) => r.key === key)?.price ?? null;

/** A little room beyond a zone, so the stop isn't hit by a touch of the zone itself. */
function buffer(levels: KeyLevels, entry: number): number {
  return Math.max((levels.atr ?? 0) * 0.25, entry * 0.005);
}

function finish(entry: number, options: LevelOption[]): LevelOption[] {
  const out: LevelOption[] = [];
  for (const o of options.sort((a, b) => Math.abs(a.pct) - Math.abs(b.pct))) {
    if (!(o.level > 0) || Math.abs(o.pct) > MAX_DISTANCE) continue;
    // Two suggestions within 1 % of each other are the same idea: keep the first (nearest).
    if (out.some((x) => Math.abs(x.level / o.level - 1) < 0.01)) continue;
    out.push(o);
    if (out.length === MAX_OPTIONS) break;
  }
  return out;
}

const option = (entry: number, level: number, basis: LevelBasis): LevelOption => {
  const l = cents(level);
  return { level: l, basis, pct: l / entry - 1 };
};

/**
 * Where a stop could go, nearest first: just beyond the nearest zone on the losing side, two
 * average daily ranges (ATR) from the entry, or beyond the 52-week extreme. Always on the
 * losing side of the entry: below it when you expect a rise, above it when you expect a fall.
 */
export function stopOptions(levels: KeyLevels | null, entry: number, direction: Direction): LevelOption[] {
  if (!levels || !(entry > 0)) return [];
  const up = direction === "up";
  const room = buffer(levels, entry);
  const out: LevelOption[] = [];
  const zones = up ? levels.supports.filter((z) => z.high < entry) : levels.resistances.filter((z) => z.low > entry);
  const nearest = up ? [...zones].sort((a, b) => b.high - a.high)[0] : [...zones].sort((a, b) => a.low - b.low)[0];
  if (nearest) out.push(option(entry, up ? nearest.low - room : nearest.high + room, { kind: "zone", side: up ? "support" : "resistance", price: cents(nearest.price), touches: nearest.touches }));
  if (levels.atr) out.push(option(entry, up ? entry - ATR_MULTIPLE * levels.atr : entry + ATR_MULTIPLE * levels.atr, { kind: "atr", atr: cents(levels.atr), multiple: ATR_MULTIPLE }));
  const extreme = ref(levels, up ? "low52" : "high52");
  if (extreme !== null && (up ? extreme < entry : extreme > entry)) out.push(option(entry, up ? extreme - room : extreme + room, { kind: up ? "low52" : "high52", price: cents(extreme) }));
  return finish(entry, out.filter((o) => (up ? o.level < entry : o.level > entry)));
}

/**
 * Where a target could go, nearest first: in front of the next zones on the winning side, the
 * 52-week extreme, or your fair value when it's on that side.
 */
export function targetOptions(levels: KeyLevels | null, entry: number, direction: Direction, fairValue: number | null): LevelOption[] {
  if (!(entry > 0)) return [];
  const up = direction === "up";
  const out: LevelOption[] = [];
  if (levels) {
    const zones = up ? levels.resistances.filter((z) => z.low > entry * 1.01) : levels.supports.filter((z) => z.high < entry * 0.99);
    for (const z of zones) out.push(option(entry, up ? z.low : z.high, { kind: "zone", side: up ? "resistance" : "support", price: cents(z.price), touches: z.touches }));
    const extreme = ref(levels, up ? "high52" : "low52");
    if (extreme !== null && (up ? extreme > entry * 1.01 : extreme < entry * 0.99)) out.push(option(entry, extreme, { kind: up ? "high52" : "low52", price: cents(extreme) }));
  }
  if (fairValue !== null && fairValue > 0 && (up ? fairValue > entry : fairValue < entry)) out.push(option(entry, fairValue, { kind: "fairValue", price: fairValue }));
  return finish(entry, out);
}

export type ReviewOption = { kind: "results"; date: string; results: string } | { kind: "months"; months: 3 | 6; date: string };

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const parse = (d: string) => Date.parse(`${d}T00:00:00Z`);
/** Weekends move to the Friday before (a review before results) or the Monday after (a review in N months). */
function weekday(t: number, before: boolean): string {
  const day = new Date(t).getUTCDay();
  if (day === 6) return iso(t + (before ? -1 : 2) * DAY);
  if (day === 0) return iso(t + (before ? -2 : 1) * DAY);
  return iso(t);
}

/** When to look at the thesis again: the market day before the next results (when they're 4 days to ~6 months away), and in 3 or 6 months. */
export function reviewOptions(today: string, nextResults: string | null): ReviewOption[] {
  const now = parse(today);
  const out: ReviewOption[] = [];
  if (nextResults) {
    const r = parse(nextResults);
    if (r - now >= 4 * DAY && r - now <= 200 * DAY) out.push({ kind: "results", date: weekday(r - DAY, true), results: nextResults });
  }
  out.push({ kind: "months", months: 3, date: weekday(now + 91 * DAY, false) });
  out.push({ kind: "months", months: 6, date: weekday(now + 182 * DAY, false) });
  return out;
}

// ---- How much to risk --------------------------------------------------------------------------

export interface RiskPrefs {
  /** The money the user plans with (null: not set yet). */
  account: number | null;
  /** Share of it they accept to lose on one idea if the stop is reached. */
  pct: number;
}
export const RISK_PCTS = [0.005, 0.01, 0.02] as const;
export const DEFAULT_RISK: RiskPrefs = { account: null, pct: 0.01 };

export function parseRisk(raw: unknown): RiskPrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_RISK;
  const r = raw as Record<string, unknown>;
  const account = typeof r.account === "number" && Number.isFinite(r.account) && r.account > 0 && r.account <= 1e10 ? Math.round(r.account * 100) / 100 : null;
  const pct = typeof r.pct === "number" && Number.isFinite(r.pct) && r.pct > 0 && r.pct <= 0.1 ? r.pct : DEFAULT_RISK.pct;
  return { account, pct };
}

export interface Sizing {
  /** What one share loses if the price goes from the entry to the stop. */
  perShare: number;
  /** The most the user said they'd lose: account × pct. */
  budget: number;
  shares: number;
  /** True when the budget would buy more than the account holds: then the account sets the number. */
  capped: boolean;
  cost: number;
  /** cost as a share of the account. */
  weight: number;
  /** What the shares lose at the stop. */
  risk: number;
  /** What they gain at the target (null: no target on the winning side). */
  reward: number | null;
  ratio: number | null;
}

/**
 * Shares = budget ÷ loss per share, rounded down; never more than the account can pay for.
 * Null when there's nothing to size: no account, no stop, or a stop on the winning side.
 */
export function positionSize(p: { account: number | null; pct: number; entry: number | null; stop: number | null; target: number | null; direction: Direction }): Sizing | null {
  const { account, pct, entry, stop, target, direction } = p;
  if (!account || account <= 0 || !(pct > 0) || !entry || entry <= 0 || !stop || stop <= 0) return null;
  const up = direction === "up";
  const perShare = up ? entry - stop : stop - entry;
  if (!(perShare > 0)) return null;
  const budget = account * pct;
  const byRisk = Math.floor(budget / perShare + 1e-9);
  const byAccount = Math.floor(account / entry + 1e-9);
  const shares = Math.min(byRisk, byAccount);
  const gainPerShare = target !== null && target > 0 ? (up ? target - entry : entry - target) : null;
  const reward = gainPerShare !== null && gainPerShare > 0 ? cents(shares * gainPerShare) : null;
  return {
    perShare: cents(perShare),
    budget: cents(budget),
    shares,
    capped: byAccount < byRisk,
    cost: cents(shares * entry),
    weight: (shares * entry) / account,
    risk: cents(shares * perShare),
    reward,
    ratio: gainPerShare !== null && gainPerShare > 0 ? gainPerShare / perShare : null,
  };
}

// ---- Why -----------------------------------------------------------------------------------------

/** "At a glance" lines that speak for the idea (good) and against it (weak); in-line ones say neither. */
export function reasonsFrom(points: VerdictPoint[], direction: Direction): { for: VerdictPoint[]; against: VerdictPoint[] } {
  const good = points.filter((p) => p.level === "good");
  const weak = points.filter((p) => p.level === "weak");
  // Expecting a fall, the weak lines are the reasons for it.
  return direction === "up" ? { for: good, against: weak } : { for: weak, against: good };
}

/** The text with each line added once (a line already there, ignoring case and spaces, isn't repeated). */
export function addLines(text: string, lines: string[]): string {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const have = new Set(text.split("\n").map(norm).filter(Boolean));
  const extra = lines.filter((l) => {
    const n = norm(l);
    if (!n || have.has(n)) return false;
    have.add(n);
    return true;
  });
  if (!extra.length) return text;
  const base = text.replace(/\s+$/, "");
  return base ? `${base}\n${extra.join("\n")}` : extra.join("\n");
}

/** The text without these lines (a choice undone). */
export function removeLines(text: string, lines: string[]): string {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const drop = new Set(lines.map(norm));
  return text
    .split("\n")
    .filter((l) => !drop.has(norm(l)))
    .join("\n");
}
