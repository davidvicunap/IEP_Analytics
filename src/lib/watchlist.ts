"use client";

// Lists kept in this browser (watchlist, recently viewed) and the dashboard's settings. The
// watchlist, its tags and columns also follow the signed-in account (see prefsSync.ts).
// - Persisted values are validated and deduplicated on every read, so a hand-edited or
//   corrupted entry can't break the app; existing saved symbols are kept as they are.
// - Changes in another tab arrive through the `storage` event.
// - When storage is unavailable (private mode, blocked cookies) the list lives in memory
//   for the session and the UI can say so.
import { useCallback, useSyncExternalStore } from "react";
import { createJsonStore, useJsonStore } from "./localStore";
import { DEFAULT_COLUMNS, parseColumns, parseTags, pruneTags, toggleColumn, toggleTag, type Column, type Tags } from "./watchDashboard";

export { RECENT_LIMIT, WATCHLIST_LIMIT, insertAt, sanitizeList } from "./watchlistShared";
import { RECENT_LIMIT, WATCHLIST_LIMIT, insertAt, sanitizeList } from "./watchlistShared";

const EMPTY: string[] = [];
const parseList = (raw: unknown) => sanitizeList(raw).slice(0, WATCHLIST_LIMIT);

// The watchlist follows the account (prefsSync); recently viewed stays per device.
const watchStore = createJsonStore<string[]>("iep.watchlist", parseList, EMPTY, "watchlist");
const recentStore = createJsonStore<string[]>("iep.recent", sanitizeList, EMPTY);

export function useWatchlist() {
  const list = useJsonStore(watchStore);
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
  const list = useJsonStore(recentStore);
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

const NO_TAGS: Tags = {};
const tagStore = createJsonStore<Tags>("iep.watchtags", parseTags, NO_TAGS, "watchtags");
const columnStore = createJsonStore<Column[]>("iep.watchcols", parseColumns, DEFAULT_COLUMNS, "watchcols");

export function useWatchTags() {
  const tags = useJsonStore(tagStore);
  const toggle = useCallback((symbol: string, tag: string) => tagStore.write(toggleTag(tagStore.read(), symbol, tag)), []);
  const prune = useCallback((list: string[]) => {
    const cur = tagStore.read();
    const next = pruneTags(cur, list);
    if (next !== cur) tagStore.write(next);
  }, []);
  return { tags, toggle, prune };
}

export function useWatchColumns() {
  const columns = useJsonStore(columnStore);
  const toggle = useCallback((c: Column) => columnStore.write(toggleColumn(columnStore.read(), c)), []);
  return { columns, toggle };
}
