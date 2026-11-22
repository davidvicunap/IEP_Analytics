"use client";

// Getting started: the four steps of the path the app is built on. Adding a holding, setting an
// exit and following a stock are read from the data itself; turning an alert channel on is
// remembered here, in this browser. Hiding the checklist is remembered too.
import { useCallback } from "react";
import { createJsonStore, useJsonStore } from "./localStore";

export interface Onboarding {
  alerts: boolean;
  hidden: boolean;
}

const EMPTY: Onboarding = { alerts: false, hidden: false };
const parse = (raw: unknown): Onboarding => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { alerts: r.alerts === true, hidden: r.hidden === true };
};

const store = createJsonStore<Onboarding>("iep.onboarding", parse, EMPTY);

/** Records that a step was done (no-op when it already was). */
export function markStep(step: "alerts") {
  const now = store.read();
  if (!now[step]) store.write({ ...now, [step]: true });
}

export function useOnboarding() {
  const state = useJsonStore(store);
  const hide = useCallback(() => store.write({ ...store.read(), hidden: true }), []);
  return { ...state, hide };
}

export type StepKey = "position" | "exit" | "alerts" | "follow";
export const STEPS: StepKey[] = ["position", "exit", "alerts", "follow"];

/** Which steps are done, from the user's data and what this browser remembers. */
export function stepsDone(o: Pick<Onboarding, "alerts">, d: { positions: number; theses: number; following: number }): Record<StepKey, boolean> {
  return { position: d.positions > 0, exit: d.theses > 0, alerts: o.alerts, follow: d.following > 0 };
}
