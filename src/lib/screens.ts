"use client";

// Saved screener searches: kept in this browser and following the signed-in account.
import { useCallback } from "react";
import { createJsonStore, useJsonStore } from "./localStore";
import { MAX_SCREENS, parseScreens, type SavedScreen } from "./prefs";

const NONE: SavedScreen[] = [];
const store = createJsonStore<SavedScreen[]>("iep:screens", parseScreens, NONE, "screens");

export function useSavedScreens() {
  const list = useJsonStore(store);
  const save = useCallback((s: SavedScreen) => store.write([...store.read().filter((x) => x.name !== s.name), s].slice(-MAX_SCREENS)), []);
  const remove = useCallback((name: string) => store.write(store.read().filter((x) => x.name !== name)), []);
  return { list, save, remove };
}
