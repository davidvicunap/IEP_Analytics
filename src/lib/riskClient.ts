"use client";

// The guided plan's account size and % at risk: kept in this browser and synced to the beta
// account like the watchlist (see prefsSync.ts).
import { createJsonStore, useJsonStore } from "./localStore";
import { DEFAULT_RISK, parseRisk, type RiskPrefs } from "./planBuilder";

export const riskStore = createJsonStore<RiskPrefs>("iep.risk", parseRisk, DEFAULT_RISK, "risk");
export const useRisk = () => useJsonStore(riskStore);
