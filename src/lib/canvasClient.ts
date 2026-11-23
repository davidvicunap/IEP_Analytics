"use client";

// Your Trading Canvas layouts in this browser, following your account like the other settings.
import { useSyncExternalStore } from "react";
import { parseCanvases, type CanvasDoc } from "./canvas";
import { createJsonStore } from "./localStore";

const NONE: CanvasDoc[] = [];
export const canvasStore = createJsonStore<CanvasDoc[]>("iep.canvases", parseCanvases, NONE, "canvases");

export function useCanvases(): CanvasDoc[] {
  return useSyncExternalStore(canvasStore.subscribe, canvasStore.read, () => NONE);
}

/** Replaces one canvas (or adds it), keeping the others' order. */
export function saveCanvas(doc: CanvasDoc) {
  const all = canvasStore.read();
  const i = all.findIndex((c) => c.id === doc.id);
  canvasStore.write(i === -1 ? [...all, doc] : all.map((c) => (c.id === doc.id ? doc : c)));
}

export function deleteCanvas(id: string) {
  canvasStore.write(canvasStore.read().filter((c) => c.id !== id));
}

export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
