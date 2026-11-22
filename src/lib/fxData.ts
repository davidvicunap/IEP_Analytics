// Server-side: how many units of a currency one US dollar buys, for showing money in the user's
// own currency. FMP's forex quote (one call per currency every 12 hours); in demo mode a fixed,
// labelled demo rate. A failure is returned as such: the page then asks for US dollars.
import { isDemo } from "./data";
import { fmpFxRate } from "./fmp";
import type { Currency, FxRate } from "./money";
import type { Result } from "./types";

const DEMO: Record<Currency, number> = { USD: 1, MXN: 18.5, COP: 4000, CLP: 950, PEN: 3.75, ARS: 1000, EUR: 0.92 };

export async function getFxRate(currency: Currency): Promise<Result<FxRate>> {
  const now = new Date().toISOString();
  if (currency === "USD") return { ok: true, data: { currency, perUsd: 1, source: "FIXED", asOf: now }, fetchedAt: now };
  if (isDemo()) return { ok: true, data: { currency, perUsd: DEMO[currency], source: "DEMO", asOf: now }, fetchedAt: now };
  const r = await fmpFxRate(currency);
  if (!r.ok) return r;
  return { ok: true, data: { currency, perUsd: r.data.perUsd, source: "FMP", asOf: r.fetchedAt }, fetchedAt: r.fetchedAt };
}
