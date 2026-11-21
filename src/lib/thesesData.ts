// Server-side: checks the user's live theses against today's facts and records the alerts.
// Facts come from data the rest of the app already caches: the quote (FMP, cached per market
// hours), "At a glance" (SEC, plus the cached price history) and SEC filings (no quota). A note
// only loads what its checks need, and a run shares each stock's facts between users.
import { getQuote, mapLimit } from "./data";
import { getFilings } from "./filings";
import type { ResearchNote } from "./research";
import { pickFilings } from "./snapshotShared";
import { holdingSignals, isHoldingKey } from "./holdingAlerts";
import type { Listing } from "./listings";
import { levelsBeforeSplit } from "./research";
import type { ResearchStore } from "./researchStore";
import type { Split } from "./splits";
import type { SymbolInfo } from "./symbolsData";
import { DEDUP_HOURS, TONE, byUrgency, evaluate, isWatched, latestByKey, needs, reconcile, statusOf, type Signal, type SignalKind, type StoredAlert, type ThesisFacts, type ThesisStatus } from "./thesis";
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

/** What the check knows besides the note: splits and listing of the stock, and where notes are saved. */
export interface CheckContext {
  splits?: Split[];
  listing?: Listing | null;
  /** To restate a note after a split (without it, the split is only reported). */
  notes?: ResearchStore | null;
}

/** A split is reported for this many days after it took effect. */
export const SPLIT_ALERT_DAYS = 7;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Checks one note, records what changed and returns what it says now. */
export async function checkThesis(owner: string, note: ResearchNote, alerts: AlertStore, facts: ReturnType<typeof factsCache>, now: Date, ctx: CheckContext = {}): Promise<ThesisView> {
  const today = marketDate(now);
  let n = note;
  const f = isWatched(n) ? await facts(n.symbol, needs(n)) : {};
  const extra: Signal[] = [];
  // Splits since the levels were set: restate the note when its levels are still in old prices
  // (never "you hit your stop" because of a split), and say so either way for a few days.
  const splits = (ctx.splits ?? []).filter((x) => x.symbol === n.symbol && x.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  for (const x of splits) {
    if (!isWatched(n)) break;
    const logged = () => n.log.some((e) => e.kind === "split" && e.date === x.date);
    let unsure = false;
    if (!logged()) {
      const old = levelsBeforeSplit(n, f.price?.value ?? null, x.ratio) ?? (n.updatedAt !== null && n.updatedAt.slice(0, 10) < x.date);
      if (!old) continue; // levels already in new prices: nothing to say
      const r = ctx.notes ? await ctx.notes.save(owner, n.symbol, { splitAdjust: { ratio: x.ratio, date: x.date }, baseUpdatedAt: null }, now) : null;
      if (r?.ok) n = r.note;
      else unsure = true; // couldn't restate: ask the user to check
    }
    if (daysBetween(x.date, today) <= SPLIT_ALERT_DAYS && (logged() || unsure)) extra.push({ key: `split:${x.date}`, kind: "split", tone: TONE.split, data: { ratio: x.ratio, date: x.date, adjusted: logged() } });
  }
  if (isWatched(n) && ctx.listing && (ctx.listing.status === "renamed" || ctx.listing.status === "delisted")) {
    const to = ctx.listing.status === "renamed" ? ctx.listing.to : undefined;
    extra.push({ key: `listing:${to ?? "gone"}`, kind: "listing", tone: TONE.listing, data: to ? { to } : {} });
  }
  const evaluated = evaluate(n, f, today);
  const signals = [...evaluated.signals, ...extra];
  const unchecked = evaluated.unchecked;
  // A holding's own alerts (results, reports) are reconciled by checkHoldings, not here.
  const stored = (await alerts.recent(owner, n.symbol, new Date(now.getTime() - DEDUP_HOURS * 3_600_000))).filter((a) => !isHoldingKey(a.key));
  const { fire, clear, revive } = reconcile(stored, signals, unchecked, now);
  const revived = latestByKey(stored, revive);
  if (fire.length || clear.length || revived.length) await alerts.apply(owner, n.symbol, fire, clear, now, revived);
  const t = now.toISOString();
  const active = [
    ...stored.filter((s) => s.clearedAt === null && !clear.includes(s.key)),
    ...revived.map((s) => ({ ...s, clearedAt: null })),
    ...fire.map((s) => ({ ...s, firedAt: t, clearedAt: null, dismissedAt: null })),
  ].sort(byUrgency);
  return { symbol: n.symbol, status: statusOf(n, active), alerts: active, unchecked, priceAt: f.price?.at ?? null };
}

/** Every watched thesis of one person (the newest first, up to MAX_CHECKED). */
export async function checkTheses(owner: string, notes: ResearchNote[], alerts: AlertStore, facts: ReturnType<typeof factsCache>, now: Date, limit = MAX_CHECKED, ctx: { info?: Map<string, SymbolInfo>; notes?: ResearchStore | null } = {}): Promise<ThesesPayload> {
  const watched = notes.filter(isWatched);
  // Over the limit, a different batch is checked each hour (so every thesis gets its turn) and the
  // rest show the alerts they already have. The nightly run checks them all.
  const fresh = new Set(rotatingBatch(watched.map((n) => n.symbol), limit, now));
  const one = (n: ResearchNote) => checkThesis(owner, n, alerts, facts, now, { splits: ctx.info?.get(n.symbol)?.splits, listing: ctx.info?.get(n.symbol)?.listing, notes: ctx.notes });
  const items = await mapLimit(watched, CONCURRENCY, (n) => (fresh.has(n.symbol) ? one(n) : storedView(owner, n, alerts, now)));
  return { items, skipped: watched.length - fresh.size };
}

/**
 * What the user owns, checked for news a broker doesn't send (results today or tomorrow, a fresh
 * report), from SEC data only (no price quota). Records what changed; returns what couldn't be checked.
 */
export async function checkHoldings(owner: string, symbols: string[], notesBySymbol: Map<string, ResearchNote>, alerts: AlertStore, facts: ReturnType<typeof factsCache>, now: Date): Promise<{ symbol: string; unchecked: SignalKind[] }[]> {
  const today = marketDate(now);
  const out = await mapLimit(symbols, CONCURRENCY, async (symbol) => {
    const note = notesBySymbol.get(symbol);
    const watching = note && isWatched(note) ? note.checks : [];
    const f = await facts(symbol, { price: false, verdict: false, filings: true });
    const { signals, unchecked } = holdingSignals(f, today, { results: watching.some((c) => c.type === "results"), report: watching.some((c) => c.type === "report") });
    const stored = (await alerts.recent(owner, symbol, new Date(now.getTime() - DEDUP_HOURS * 3_600_000))).filter((a) => isHoldingKey(a.key));
    const { fire, clear, revive } = reconcile(stored, signals, unchecked, now);
    const revived = latestByKey(stored, revive);
    if (fire.length || clear.length || revived.length) await alerts.apply(owner, symbol, fire, clear, now, revived);
    return { symbol, unchecked };
  });
  return out.filter((x) => x.unchecked.length > 0);
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
