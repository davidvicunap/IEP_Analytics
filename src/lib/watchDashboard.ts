// The watchlist dashboard's pure parts: which columns are shown, tags per stock, and sorting
// with gaps last. Browser storage is validated on every read, so a hand-edited value can't
// break the page.
import { upside } from "./research";
import type { SnapshotPayload } from "./snapshotShared";

export const COLUMNS = ["fairValue", "quality", "report", "latest", "insiders", "marketCap"] as const;
export type Column = (typeof COLUMNS)[number];
export const DEFAULT_COLUMNS: Column[] = ["fairValue", "quality", "latest", "insiders"];

/** Known columns only, in the canonical order; anything unreadable gives the defaults. */
export function parseColumns(raw: unknown): Column[] {
  if (!Array.isArray(raw)) return DEFAULT_COLUMNS;
  const set = new Set(raw.filter((c): c is Column => typeof c === "string" && (COLUMNS as readonly string[]).includes(c)));
  return COLUMNS.filter((c) => set.has(c));
}

export function toggleColumn(cols: Column[], c: Column): Column[] {
  const set = new Set(cols);
  if (set.has(c)) set.delete(c);
  else set.add(c);
  return COLUMNS.filter((k) => set.has(k));
}

// ---- Tags ----------------------------------------------------------------------------------

export const TAG_MAX_LENGTH = 24;
export const TAGS_PER_STOCK = 8;
export const TAGS_TOTAL = 30;

export type Tags = Record<string, string[]>;

/** Trimmed, single spaces, at most 24 characters; empty when nothing is left. */
export function cleanTag(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, TAG_MAX_LENGTH).trim();
}

const sameTag = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** Tags per symbol: valid strings, no duplicates (case-insensitive), within the limits. */
export function parseTags(raw: unknown): Tags {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Tags = {};
  const all: string[] = [];
  for (const [symbol, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[A-Z][A-Z.\-]{0,9}$/.test(symbol) || !Array.isArray(list)) continue;
    const tags: string[] = [];
    for (const item of list) {
      if (typeof item !== "string") continue;
      const tag = cleanTag(item);
      if (!tag || tags.some((t) => sameTag(t, tag)) || tags.length >= TAGS_PER_STOCK) continue;
      const known = all.find((t) => sameTag(t, tag));
      if (!known && all.length >= TAGS_TOTAL) continue;
      if (!known) all.push(tag);
      tags.push(known ?? tag);
    }
    if (tags.length) out[symbol] = tags;
  }
  return out;
}

/** Every tag in use, alphabetical, with how many of the listed stocks carry it. */
export function tagCounts(tags: Tags, list: string[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of list) for (const t of tags[s] ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag));
}

/** Adds or removes `tag` on `symbol`; an existing tag keeps its spelling. Unchanged when a limit is hit. */
export function toggleTag(tags: Tags, symbol: string, raw: string): Tags {
  const tag = cleanTag(raw);
  if (!tag) return tags;
  const mine = tags[symbol] ?? [];
  if (mine.some((t) => sameTag(t, tag))) {
    const rest = mine.filter((t) => !sameTag(t, tag));
    const next = { ...tags };
    if (rest.length) next[symbol] = rest;
    else delete next[symbol];
    return next;
  }
  const everyTag = [...new Set(Object.values(tags).flat())];
  const known = everyTag.find((t) => sameTag(t, tag));
  if (mine.length >= TAGS_PER_STOCK || (!known && everyTag.length >= TAGS_TOTAL)) return tags;
  return { ...tags, [symbol]: [...mine, known ?? tag] };
}

/** Removes the symbols no longer on the list, so tags don't pile up for stocks you dropped. */
export function pruneTags(tags: Tags, list: string[]): Tags {
  const keep = new Set(list);
  const entries = Object.entries(tags).filter(([s]) => keep.has(s));
  return entries.length === Object.keys(tags).length ? tags : Object.fromEntries(entries);
}

// ---- Sorting -------------------------------------------------------------------------------

export type SortKey = "saved" | "symbol" | "change" | Column;
export type SortDir = "asc" | "desc";

export interface RowFacts {
  symbol: string;
  price: number | null;
  change: number | null;
  marketCap: number | null;
  fairValue: number | null;
  snapshot: SnapshotPayload | null;
}

/** The number (or date) a column sorts by; null when the row has no value for it. */
export function sortValue(r: RowFacts, key: Exclude<SortKey, "saved" | "symbol">): number | string | null {
  const s = r.snapshot;
  switch (key) {
    case "change":
      return r.change;
    case "marketCap":
      return r.marketCap;
    case "fairValue":
      return upside(r.fairValue, r.price);
    case "quality": {
      if (!s?.quality.ok) return null;
      const judged = s.quality.data.passed + s.quality.data.failed;
      return judged ? s.quality.data.passed / judged : null;
    }
    case "report":
      return s?.filings.ok ? (s.filings.data.report?.filed ?? null) : null;
    case "latest":
      return s?.filings.ok ? (s.filings.data.latest?.filed ?? null) : null;
    case "insiders":
      return s?.insiders.ok ? s.insiders.data.bought - s.insiders.data.sold : null;
  }
}

/** Rows in the chosen order; rows without a value always go last, whichever the direction. */
export function sortRows<T extends RowFacts>(rows: T[], key: SortKey, dir: SortDir): T[] {
  if (key === "saved") return dir === "asc" ? rows : [...rows].reverse();
  const sign = dir === "asc" ? 1 : -1;
  if (key === "symbol") return [...rows].sort((a, b) => sign * a.symbol.localeCompare(b.symbol));
  return [...rows].sort((a, b) => {
    const x = sortValue(a, key);
    const y = sortValue(b, key);
    if (x === null) return y === null ? a.symbol.localeCompare(b.symbol) : 1;
    if (y === null) return -1;
    const c = typeof x === "string" ? x.localeCompare(y as string) : x - (y as number);
    return c === 0 ? a.symbol.localeCompare(b.symbol) : sign * c;
  });
}

/** The first click on a column sorts the way that's most useful: biggest or newest first, A→Z for names. */
export function nextSort(cur: { key: SortKey; dir: SortDir }, key: SortKey): { key: SortKey; dir: SortDir } {
  if (cur.key === key) return { key, dir: cur.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "symbol" || key === "saved" ? "asc" : "desc" };
}
