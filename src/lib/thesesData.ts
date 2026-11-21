// Server-side: checks the user's live theses against today's facts and records the alerts.
// Facts come from data the rest of the app already caches: the quote (FMP, cached per market
// hours), "At a glance" (SEC, plus the cached price history) and SEC filings (no quota). A note
// only loads what its checks need, and a run shares each stock's facts between users.
import { getQuote, mapLimit } from "./data";
import { getFilings } from "./filings";
import type { ResearchNote } from "./research";
import { pickFilings } from "./snapshotShared";
import { DEDUP_HOURS, byUrgency, evaluate, isWatched, latestByKey, needs, reconcile, statusOf, type SignalKind, type StoredAlert, type ThesisFacts, type ThesisStatus } from "./thesis";
import type { AlertStore } from "./thesisAlertStore";
import { getVerdict } from "./verdictData";

/** Today's date in New York (YYYY-MM-DD): review dates and results are market days. */
export const marketDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** At most this many theses are checked per request (a run checks the rest next time). */
export const MAX_CHECKED = 40;
const CONCURRENCY = 3;

export interface ThesisView {
  symbol: string;
  status: ThesisStatus;
  /** Active alerts, most urgent first. */
  alerts: StoredAlert[];
  /** Kinds that couldn't be checked this time (their data was unavailable). */
  unchecked: SignalKind[];
  /** When the price used was taken (null: no price needed or none available). */
  priceAt: string | null;
}

export interface ThesesPayload {
  items: ThesisView[];
  /** Watched theses left for later because of MAX_CHECKED. */
  skipped: number;
}

type Needs = ReturnType<typeof needs>;

async function loadFacts(symbol: string, n: Needs, today: string): Promise<ThesisFacts> {
  const f: ThesisFacts = {};
  await Promise.all([
    n.price &&
      getQuote(symbol).then((r) => {
        if (!r.ok || !(r.data.price > 0)) return void (f.price = null);
        // A day's move only from a live quote; a stored or closing price still checks levels.
        const live = !r.data.basis;
        f.price = { value: r.data.price, changePct: live && Number.isFinite(r.data.changePercent) ? r.data.changePercent : null, at: r.data.asOf ?? r.fetchedAt };
      }),
    n.verdict &&
      getVerdict(symbol).then((r) => {
        f.verdict = r.ok ? Object.fromEntries(r.data.points.map((p) => [p.key, p.level])) : null;
      }),
    n.filings &&
      getFilings(symbol).then((r) => {
        if (!r.ok) {
          f.report = null;
          f.nextResults = null;
          return;
        }
        const picked = pickFilings(r.data.filings, today);
        f.report = picked.report ? { accn: picked.report.accn, form: picked.report.form, filed: picked.report.filed } : undefined;
        f.nextResults = picked.nextResults ? { date: picked.nextResults.date } : undefined;
      }),
  ]);
  return f;
}

/** Facts shared by the stocks of one run; a stock asked for with more needs loads again. */
export function factsCache(today: string) {
  const cache = new Map<string, Promise<ThesisFacts>>();
  return (symbol: string, n: Needs) => {
    const key = `${symbol}|${+n.price}${+n.verdict}${+n.filings}`;
    if (!cache.has(key)) cache.set(key, loadFacts(symbol, n, today).catch(() => ({ price: n.price ? null : undefined, verdict: n.verdict ? null : undefined, report: n.filings ? null : undefined, nextResults: n.filings ? null : undefined })));
    return cache.get(key)!;
  };
}

/** Checks one note, records what changed and returns what it says now. */
export async function checkThesis(owner: string, note: ResearchNote, alerts: AlertStore, facts: ReturnType<typeof factsCache>, now: Date): Promise<ThesisView> {
  const today = marketDate(now);
  const f = isWatched(note) ? await facts(note.symbol, needs(note)) : {};
  const { signals, unchecked } = evaluate(note, f, today);
  const stored = await alerts.recent(owner, note.symbol, new Date(now.getTime() - DEDUP_HOURS * 3_600_000));
  const { fire, clear, revive } = reconcile(stored, signals, unchecked, now);
  const revived = latestByKey(stored, revive);
  if (fire.length || clear.length || revived.length) await alerts.apply(owner, note.symbol, fire, clear, now, revived);
  const t = now.toISOString();
  const active = [
    ...stored.filter((s) => s.clearedAt === null && !clear.includes(s.key)),
    ...revived.map((s) => ({ ...s, clearedAt: null })),
    ...fire.map((s) => ({ ...s, firedAt: t, clearedAt: null, dismissedAt: null })),
  ].sort(byUrgency);
  return { symbol: note.symbol, status: statusOf(note, active), alerts: active, unchecked, priceAt: f.price?.at ?? null };
}

/** Every watched thesis of one person (the newest first, up to MAX_CHECKED). */
export async function checkTheses(owner: string, notes: ResearchNote[], alerts: AlertStore, facts: ReturnType<typeof factsCache>, now: Date, limit = MAX_CHECKED): Promise<ThesesPayload> {
  const watched = notes.filter(isWatched);
  // Over the limit, a different batch is checked each hour (so every thesis gets its turn) and the
  // rest show the alerts they already have. The nightly run checks them all.
  const fresh = new Set(rotatingBatch(watched.map((n) => n.symbol), limit, now));
  const items = await mapLimit(watched, CONCURRENCY, (n) => (fresh.has(n.symbol) ? checkThesis(owner, n, alerts, facts, now) : storedView(owner, n, alerts, now)));
  return { items, skipped: watched.length - fresh.size };
}

/** `limit` symbols out of `all`, starting at a place that moves every hour. */
export function rotatingBatch(all: string[], limit: number, now: Date): string[] {
  if (all.length <= limit) return all;
  const start = (Math.floor(now.getTime() / 3_600_000) * limit) % all.length;
  return Array.from({ length: limit }, (_, i) => all[(start + i) % all.length]);
}

/** A thesis not checked this time: its active alerts and status as last recorded. */
async function storedView(owner: string, note: ResearchNote, alerts: AlertStore, now: Date): Promise<ThesisView> {
  const stored = await alerts.recent(owner, note.symbol, new Date(now.getTime() - DEDUP_HOURS * 3_600_000));
  const active = stored.filter((s) => s.clearedAt === null).sort(byUrgency);
  return { symbol: note.symbol, status: statusOf(note, active), alerts: active, unchecked: [], priceAt: null };
}
