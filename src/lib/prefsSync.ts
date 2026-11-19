"use client";

// Browser side of account settings. Local stores (watchlist, tags, columns, chart packs, saved
// screens) register here; this module reads the account once per visit and when the tab comes
// back, applies what changed (see planSync in prefs.ts), and saves local edits shortly after
// they happen. Everything keeps working offline: edits stay in this browser and are saved on
// the next successful attempt.
import { useSyncExternalStore } from "react";
import { planSync, type PrefKey } from "./prefs";
import type { StoredPrefs } from "./prefsStore";
import { fetchViewResult, toViewResult, type ViewIssue } from "./resource";

export type SyncStatus =
  | { kind: "idle" } // not started yet (server render, first paint)
  | { kind: "local" } // no account to save to here (demo without a database, server not configured)
  | { kind: "syncing" }
  | { kind: "synced"; at: string }
  | { kind: "error"; issue: ViewIssue }; // edits are kept in this browser and retried

interface Synced {
  read(): unknown;
  apply(value: unknown): void; // write locally without saving back
}

const SAVE_DELAY_MS = 800;
const PULL_EVERY_MS = 30_000;
const seenKey = (k: PrefKey) => `iep.sync.v1.${k}`;

const registry = new Map<PrefKey, Synced>();
const dirty = new Set<PrefKey>();
const timers = new Map<PrefKey, ReturnType<typeof setTimeout>>();
let account: StoredPrefs | null = null;
let lastPull = 0;
let started = false;
let pulling: Promise<void> | null = null;
const IDLE: SyncStatus = { kind: "idle" };
let status: SyncStatus = IDLE;
const listeners = new Set<() => void>();

function setStatus(s: SyncStatus) {
  status = s;
  listeners.forEach((l) => l());
}

function getSeen(k: PrefKey): string | null {
  try {
    return localStorage.getItem(seenKey(k));
  } catch {
    return null;
  }
}
function setSeen(k: PrefKey, v: string) {
  try {
    localStorage.setItem(seenKey(k), v);
  } catch {
    /* blocked storage: this device will merge again next visit, which loses nothing */
  }
}

function reconcile(k: PrefKey) {
  const s = registry.get(k);
  if (!s || !account) return;
  const plan = planSync(k, account[k], s.read(), getSeen(k), dirty.has(k));
  if (plan.apply !== undefined) s.apply(plan.apply);
  if (plan.mark !== undefined) setSeen(k, plan.mark);
  if (plan.upload) schedule(k, 0);
}

async function upload(k: PrefKey) {
  const s = registry.get(k);
  if (!s) return;
  dirty.delete(k);
  setStatus({ kind: "syncing" });
  let res: Response;
  try {
    res = await fetch(`/api/prefs/${k}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: s.read() }) });
  } catch {
    dirty.add(k);
    return setStatus({ kind: "error", issue: "upstream" });
  }
  const r = toViewResult<{ value: unknown; updatedAt: string }>(res.status, await res.json().catch(() => null));
  if (!r.ok) {
    if (r.error === "not_configured") return setStatus({ kind: "local" });
    dirty.add(k);
    return setStatus({ kind: "error", issue: r.error });
  }
  account = { ...(account ?? {}), [k]: { value: r.data.value, updatedAt: r.data.updatedAt } };
  setSeen(k, r.data.updatedAt);
  if (dirty.size === 0) setStatus({ kind: "synced", at: r.data.updatedAt });
}

function schedule(k: PrefKey, delay = SAVE_DELAY_MS) {
  dirty.add(k);
  clearTimeout(timers.get(k));
  // Before the first read of the account there's nothing to compare with: wait for it.
  if (!account) return;
  timers.set(k, setTimeout(() => void upload(k), delay));
}

async function pull() {
  if (pulling) return pulling;
  pulling = (async () => {
    if (status.kind !== "synced") setStatus({ kind: "syncing" });
    const r = await fetchViewResult<StoredPrefs>("/api/prefs");
    lastPull = Date.now();
    if (!r.ok) {
      setStatus(r.error === "not_configured" ? { kind: "local" } : { kind: "error", issue: r.error });
      return;
    }
    account = r.data;
    for (const k of registry.keys()) reconcile(k);
    for (const k of dirty) schedule(k, 0);
    if (dirty.size === 0) setStatus({ kind: "synced", at: new Date(lastPull).toISOString() });
  })().finally(() => {
    pulling = null;
  });
  return pulling;
}

/** A local store that follows the account. Called when its module loads (in the browser). */
export function registerSynced(k: PrefKey, s: Synced) {
  if (typeof window === "undefined") return;
  registry.set(k, s);
  if (account) reconcile(k);
}

/** A local edit: saved to the account shortly after (several quick edits make one request). */
export function markChanged(k: PrefKey) {
  if (typeof window === "undefined" || !registry.has(k)) return;
  if (status.kind === "local") return;
  schedule(k);
}

/** Starts syncing once per page load; reads the account again when the tab comes back. */
export function startSync() {
  if (started || typeof window === "undefined") return;
  started = true;
  void pull();
  const again = () => {
    if (document.visibilityState === "visible" && Date.now() - lastPull > PULL_EVERY_MS) void pull();
  };
  document.addEventListener("visibilitychange", again);
  window.addEventListener("online", () => void pull());
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => status,
    () => IDLE,
  );
}
