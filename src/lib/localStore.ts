"use client";

// A JSON value in this browser's localStorage, validated on every read and shared by every
// view through useSyncExternalStore. Changes in another tab arrive through the `storage`
// event; when storage is blocked the value lives in memory for the session. A store given a
// `sync` key also follows the signed-in account (see prefsSync.ts).
import { useSyncExternalStore } from "react";
import type { PrefKey } from "./prefs";
import { markChanged, registerSynced } from "./prefsSync";

export interface JsonStore<T> {
  read(): T;
  /** A change made here: saved locally and, for synced stores, to the account shortly after. */
  write(value: T): void;
  /** A value that came from the account: saved locally only. */
  apply(value: T): void;
  subscribe(cb: () => void): () => void;
  /** False when this browser can't store data (private mode): the value lasts for this visit. */
  persistent(): boolean;
  fallback: T;
}

export function createJsonStore<T>(key: string, parse: (raw: unknown) => T, fallback: T, sync?: PrefKey): JsonStore<T> {
  let cache: T | null = null;
  let memoryOnly = false;
  const listeners = new Set<() => void>();
  const save = (value: T) => {
    cache = value;
    try {
      localStorage.setItem(key, JSON.stringify(value));
      memoryOnly = false;
    } catch {
      memoryOnly = true; // storage unavailable: kept in memory for this session
    }
    listeners.forEach((l) => l());
  };
  const store: JsonStore<T> = {
    fallback,
    read() {
      if (cache !== null) return cache;
      try {
        const raw = localStorage.getItem(key);
        cache = raw ? parse(JSON.parse(raw)) : fallback;
      } catch {
        cache = fallback;
      }
      return cache;
    },
    write(value) {
      save(value);
      if (sync) markChanged(sync);
    },
    apply(value) {
      save(parse(value));
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
  if (sync) registerSynced(sync, { read: () => store.read(), apply: (v) => store.apply(v as T) });
  return store;
}

export function useJsonStore<T>(store: JsonStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.read, () => store.fallback);
}
