"use client";

// Your saved chart indicators in this browser, following your account like the other settings.
import { useSyncExternalStore } from "react";
import { parseStudies, type ChartStudy } from "./chartStudies";
import { createJsonStore } from "./localStore";

const NONE: ChartStudy[] = [];
export const studiesStore = createJsonStore<ChartStudy[]>("iep.chartstudies", parseStudies, NONE, "chartstudies");

export function useChartStudies(): ChartStudy[] {
  return useSyncExternalStore(studiesStore.subscribe, studiesStore.read, () => NONE);
}
