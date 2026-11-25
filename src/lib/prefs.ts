// Settings that follow you across devices (saved to your beta account): which keys, how each
// value is validated (the server never stores anything the app couldn't read back), and how a
// device's own settings merge with the account's the first time that device syncs, so nothing
// you saved before is lost. Pure: storage is prefsStore.ts, the browser side prefsSync.ts.
import { mergeCanvases, parseCanvases } from "./canvas";
import { parseStudies } from "./chartStudies";
import { parseRisk } from "./planBuilder";
import { parseColumns, parseTags, toggleTag, type Tags } from "./watchDashboard";
import { WATCHLIST_LIMIT, sanitizeList } from "./watchlistShared";

/** `risk`: the account size and % at risk the guided plan sizes positions with; `canvases`: Trading Canvas layouts; `chartstudies`: the indicators TradingView charts open with. */
export const PREF_KEYS = ["watchlist", "watchtags", "watchcols", "screens", "risk", "canvases", "chartstudies"] as const;
export type PrefKey = (typeof PREF_KEYS)[number];
export const isPrefKey = (k: string): k is PrefKey => (PREF_KEYS as readonly string[]).includes(k);

/** The largest value accepted per key (JSON bytes): far above any real use, a guard against abuse. */
export const PREF_MAX_BYTES = 64_000;
/** Canvases hold many windows and notes: a larger allowance. */
export const prefMaxBytes = (key: PrefKey) => (key === "canvases" ? 256_000 : PREF_MAX_BYTES);

export interface SavedScreen {
  name: string;
  query: string; // the screener's URL parameters
}
export const MAX_SCREENS = 20;

/** Saved screener searches: named, with their URL parameters; duplicates by name dropped. */
export function parseScreens(raw: unknown): SavedScreen[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedScreen[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const { name, query } = x as Record<string, unknown>;
    if (typeof name !== "string" || typeof query !== "string") continue;
    const n = name.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!n || query.length > 2000 || out.some((s) => s.name === n)) continue;
    out.push({ name: n, query });
    if (out.length >= MAX_SCREENS) break;
  }
  return out;
}

const PARSE: Record<PrefKey, (raw: unknown) => unknown> = {
  watchlist: (raw) => sanitizeList(raw).slice(0, WATCHLIST_LIMIT),
  watchtags: parseTags,
  watchcols: parseColumns,
  screens: parseScreens,
  risk: parseRisk,
  canvases: parseCanvases,
  chartstudies: parseStudies,
};

/** Keys whose value is an object rather than a list. */
const OBJECT_KEYS = new Set<PrefKey>(["watchtags", "risk"]);

/** The value as the app would read it back, or null when it isn't the right shape at all. */
export function normalizePref(key: PrefKey, raw: unknown): unknown {
  if (OBJECT_KEYS.has(key) ? !raw || typeof raw !== "object" || Array.isArray(raw) : !Array.isArray(raw)) return null;
  return PARSE[key](raw);
}

/** True when a value holds nothing worth keeping (a new device's defaults). */
export function isEmptyPref(key: PrefKey, value: unknown): boolean {
  if (key === "watchcols") return false; // the column choice is never "empty": it's a choice
  if (key === "watchtags") return !value || Object.keys(value as object).length === 0;
  if (key === "risk") return parseRisk(value).account === null;
  return !Array.isArray(value) || value.length === 0;
}

/**
 * The first time a device syncs a key that the account already has: the account's value
 * comes first and the device adds what the account lacks. Columns are a single choice, so the
 * account's wins. After that first time the account is the source of truth for that device.
 */
export function mergePref(key: PrefKey, account: unknown, device: unknown): unknown {
  switch (key) {
    case "watchlist":
      return sanitizeList([...sanitizeList(account), ...sanitizeList(device)]).slice(0, WATCHLIST_LIMIT);
    case "watchtags": {
      let tags: Tags = parseTags(account);
      for (const [symbol, list] of Object.entries(parseTags(device))) {
        for (const tag of list) if (!tags[symbol]?.some((t) => t.toLocaleLowerCase() === tag.toLocaleLowerCase())) tags = toggleTag(tags, symbol, tag);
      }
      return tags;
    }
    case "watchcols":
      return parseColumns(account);
    case "screens":
      return parseScreens([...parseScreens(account), ...parseScreens(device)]);
    case "risk":
      // One choice: the account's, unless it has none yet.
      return parseRisk(account).account !== null ? parseRisk(account) : parseRisk(device);
    case "canvases":
      return mergeCanvases(account, device);
    case "chartstudies":
      // One choice: the account's, unless it has none yet.
      return parseStudies(account).length ? parseStudies(account) : parseStudies(device);
  }
}

export interface SyncPlan {
  apply?: unknown; // write this to the device
  upload: boolean; // then save the device's value to the account
  mark?: string; // remember this account version as seen on this device ("" = nothing yet)
}

/**
 * What a device does with one key after reading the account:
 * - `seen` is the account version this device last applied (null: never synced this key).
 * - First sync: merge (account first, device extras added); upload if the merge added anything.
 *   With nothing on the account, upload the device's value unless it's empty.
 * - Later: take the account's value when it changed since `seen`; local edits waiting to be
 *   uploaded (`dirty`) win over it and are uploaded instead.
 */
export function planSync(key: PrefKey, account: { value: unknown; updatedAt: string } | undefined, device: unknown, seen: string | null, dirty: boolean): SyncPlan {
  if (dirty) return { upload: true };
  if (seen === null) {
    if (!account) return isEmptyPref(key, device) ? { upload: false, mark: "" } : { upload: true };
    const merged = mergePref(key, account.value, device);
    const same = JSON.stringify(merged) === JSON.stringify(normalizePref(key, account.value));
    return same ? { apply: merged, upload: false, mark: account.updatedAt } : { apply: merged, upload: true };
  }
  if (account && account.updatedAt !== seen) return { apply: normalizePref(key, account.value) ?? undefined, upload: false, mark: account.updatedAt };
  return { upload: false };
}
