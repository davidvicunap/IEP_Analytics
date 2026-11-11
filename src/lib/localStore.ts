"use client";

// A JSON value in this browser's localStorage, validated on every read and shared by every
// view through useSyncExternalStore. Changes in another tab arrive through the `storage`
// event; when storage is blocked the value lives in memory for the session.
import { useSyncExternalStore } from "react";

export interface JsonStore<T> {
  read(): T;
  write(value: T): void;
  subscribe(cb: () => void): () => void;
  fallback: T;
}

export function createJsonStore<T>(key: string, parse: (raw: unknown) => T, fallback: T): JsonStore<T> {
  let cache: T | null = null;
  const listeners = new Set<() => void>();
  return {
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
      cache = value;
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // storage unavailable: kept in memory for this session
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
  };
}

export function useJsonStore<T>(store: JsonStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.read, () => store.fallback);
}
