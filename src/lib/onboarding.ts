"use client";

// Getting started: the few steps that show what the app is for. Following a stock and writing a
// thesis are read from the data itself; comparing and trying the commands are remembered here,
// in this browser. Hiding the checklist is remembered too.
import { useCallback } from "react";
import { createJsonStore, useJsonStore } from "./localStore";

export interface Onboarding {
  compare: boolean;
  palette: boolean;
  hidden: boolean;
}

const EMPTY: Onboarding = { compare: false, palette: false, hidden: false };
const parse = (raw: unknown): Onboarding => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { compare: r.compare === true, palette: r.palette === true, hidden: r.hidden === true };
};

const store = createJsonStore<Onboarding>("iep.onboarding", parse, EMPTY);

/** Records that a step was done (no-op when it already was). */
export function markStep(step: "compare" | "palette") {
  const now = store.read();
  if (!now[step]) store.write({ ...now, [step]: true });
}

export function useOnboarding() {
  const state = useJsonStore(store);
  const hide = useCallback(() => store.write({ ...store.read(), hidden: true }), []);
  return { ...state, hide };
}

export type StepKey = "follow" | "thesis" | "compare" | "palette";
export const STEPS: StepKey[] = ["follow", "thesis", "compare", "palette"];

/** Which steps are done, from the user's data and what this browser remembers. */
export function stepsDone(o: Pick<Onboarding, "compare" | "palette">, following: number, theses: number): Record<StepKey, boolean> {
  return { follow: following > 0, thesis: theses > 0, compare: o.compare, palette: o.palette };
}
