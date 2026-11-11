"use client";

// Browser-local lists (watchlist, recently viewed). Nothing leaves the browser.
// - Persisted values are validated and deduplicated on every read, so a hand-edited or
//   corrupted entry can't break the app; existing saved symbols are kept as they are.
// - Changes in another tab arrive through the `storage` event.
// - When storage is unavailable (private mode, blocked cookies) the list lives in memory
//   for the session and the UI can say so.
import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_COLUMNS, parseColumns, parseTags, pruneTags, toggleColumn, toggleTag, type Column, type Tags } from "./watchDashboard";

/** The most a watchlist can hold. Quotes are fetched 30 at a time, so 100 means 4 requests. */
export const WATCHLIST_LIMIT = 100;
export const RECENT_LIMIT = 8;

const SYMBOL = /^[A-Z][A-Z.\-]{0,9}$/;

/** Uppercase, valid tickers only, first occurrence wins. */
export function sanitizeList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const s = item.trim().toUpperCase();
    if (!SYMBOL.test(s) || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** Insert `symbol` at `index` (or the end), keeping the list unique. */
export function insertAt(list: string[], symbol: string, index?: number): string[] {
  const rest = list.filter((s) => s !== symbol);
  const i = index === undefined ? rest.length : Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, i), symbol, ...rest.slice(i)];
}

interface Store {
  read(): string[];
  write(list: string[]): void;
  subscribe(cb: () => void): () => void;
  persistent(): boolean;
}

const EMPTY: string[] = [];

function createStore(key: string): Store {
  let cache: string[] | null = null;
  let memoryOnly = false;
  const listeners = new Set<() => void>();
  return {
    read() {
      if (cache) return cache;
      try {
        const raw = localStorage.getItem(key);
        cache = sanitizeList(raw ? JSON.parse(raw) : []);
      } catch {
        cache = [];
      }
      return cache;
    },
    write(list) {
      cache = list;
      try {
        localStorage.setItem(key, JSON.stringify(list));
        memoryOnly = false;
      } catch {
        memoryOnly = true; // storage unavailable: keep it for this session
      }
      listeners.forEach((l) => l());
    },
    subscribe(cb) {
      listeners.add(cb);
      const onStorage = (e: StorageEvent) => {
        if (e.key === key || e.key === null) {
          cache = null;
          cb();
        }
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(cb);
        window.removeEventListener("storage", onStorage);
      };
    },
    persistent: () => !memoryOnly,
  };
}

const watchStore = createStore("iep.watchlist");
const recentStore = createStore("iep.recent");

export function useWatchlist() {
  const list = useSyncExternalStore(watchStore.subscribe, watchStore.read, () => EMPTY);
  const add = useCallback((symbol: string, index?: number) => {
    const cur = watchStore.read();
    if (!cur.includes(symbol) && cur.length >= WATCHLIST_LIMIT) return false;
    watchStore.write(insertAt(cur, symbol, index));
    return true;
  }, []);
  const remove = useCallback((symbol: string) => watchStore.write(watchStore.read().filter((s) => s !== symbol)), []);
  const toggle = useCallback(
    (symbol: string) => (watchStore.read().includes(symbol) ? remove(symbol) : add(symbol)),
    [add, remove],
  );
  return { list, add, remove, toggle, has: (s: string) => list.includes(s), persistent: watchStore.persistent() };
}

/** Recently viewed stocks, newest first. */
export function useRecent() {
  const list = useSyncExternalStore(recentStore.subscribe, recentStore.read, () => EMPTY);
  const record = useCallback((symbol: string) => {
    const cur = recentStore.read();
    if (cur[0] === symbol) return;
    recentStore.write(insertAt(cur, symbol, 0).slice(0, RECENT_LIMIT));
  }, []);
  const clear = useCallback(() => recentStore.write([]), []);
  return { list, record, clear };
}

/** False during server rendering and hydration, true once browser storage can be read. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

// ---- Dashboard settings: tags per stock and the columns shown --------------------------------

function createJsonStore<T>(key: string, parse: (raw: unknown) => T, fallback: T) {
  let cache: T | null = null;
  const listeners = new Set<() => void>();
  return {
    read(): T {
      if (cache !== null) return cache;
      try {
        const raw = localStorage.getItem(key);
        cache = raw ? parse(JSON.parse(raw)) : fallback;
      } catch {
        cache = fallback;
      }
      return cache;
    },
    write(value: T) {
      cache = value;
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // storage unavailable: kept in memory for this session
      }
      listeners.forEach((l) => l());
    },
    subscribe(cb: () => void) {
      listeners.add(cb);
      const onStorage = (e: StorageEvent) => {
        if (e.key === key || e.key === null) {
          cache = null;
          cb();
        }
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(cb);
        window.removeEventListener("storage", onStorage);
      };
    },
  };
}

const NO_TAGS: Tags = {};
const tagStore = createJsonStore<Tags>("iep.watchtags", parseTags, NO_TAGS);
const columnStore = createJsonStore<Column[]>("iep.watchcols", parseColumns, DEFAULT_COLUMNS);

export function useWatchTags() {
  const tags = useSyncExternalStore(tagStore.subscribe, tagStore.read, () => NO_TAGS);
  const toggle = useCallback((symbol: string, tag: string) => tagStore.write(toggleTag(tagStore.read(), symbol, tag)), []);
  const prune = useCallback((list: string[]) => {
    const cur = tagStore.read();
    const next = pruneTags(cur, list);
    if (next !== cur) tagStore.write(next);
  }, []);
  return { tags, toggle, prune };
}

export function useWatchColumns() {
  const columns = useSyncExternalStore(columnStore.subscribe, columnStore.read, () => DEFAULT_COLUMNS);
  const toggle = useCallback((c: Column) => columnStore.write(toggleColumn(columnStore.read(), c)), []);
  return { columns, toggle };
}
