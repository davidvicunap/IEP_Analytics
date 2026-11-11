"use client";

// Your chart packs in this browser (built-in ones always come first).
import { useCallback, useMemo } from "react";
import { BUILTIN_PACKS, addChart, createPack, deletePack, moveChart, parsePacks, removeChart, renamePack, type Pack, type PackChart, type PackEdit } from "./chartPacks";
import { createJsonStore, useJsonStore } from "./localStore";

const NONE: Pack[] = [];
const store = createJsonStore<Pack[]>("iep.chartpacks", parsePacks, NONE);

const newId = () => `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function usePacks() {
  const mine = useJsonStore(store);
  const all = useMemo(() => [...BUILTIN_PACKS, ...mine], [mine]);
  const apply = useCallback((r: PackEdit) => {
    if (r.ok) store.write(r.packs);
    return r;
  }, []);
  return {
    all,
    mine,
    create: useCallback((name: string, first?: PackChart) => {
      const id = newId();
      return { id, result: apply(createPack(store.read(), name, id, first)) };
    }, [apply]),
    add: useCallback((packId: string, chart: PackChart) => apply(addChart(store.read(), packId, chart)), [apply]),
    remove: useCallback((packId: string, index: number) => store.write(removeChart(store.read(), packId, index)), []),
    move: useCallback((packId: string, index: number, by: -1 | 1) => store.write(moveChart(store.read(), packId, index, by)), []),
    rename: useCallback((packId: string, name: string) => store.write(renamePack(store.read(), packId, name)), []),
    drop: useCallback((packId: string) => store.write(deletePack(store.read(), packId)), []),
    restore: useCallback((packs: Pack[]) => store.write(packs), []),
  };
}
