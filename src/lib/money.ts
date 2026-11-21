// Money in the user's currency. US stocks are priced in US dollars; the user may think in pesos,
// soles or euros. Amounts always carry their currency (never a bare "$", which means pesos in
// much of Latin America), and conversions say which rate they used and from when.

export const CURRENCIES = ["USD", "MXN", "COP", "CLP", "PEN", "ARS", "EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];
export const isCurrency = (v: unknown): v is Currency => typeof v === "string" && (CURRENCIES as readonly string[]).includes(v);

/** How each currency is written: an unmistakable prefix, and how many decimals make sense. */
const STYLE: Record<Currency, { prefix: string; digits: number }> = {
  USD: { prefix: "US$", digits: 2 },
  MXN: { prefix: "MX$", digits: 2 },
  COP: { prefix: "COL$", digits: 0 },
  CLP: { prefix: "CLP$", digits: 0 },
  PEN: { prefix: "S/", digits: 2 },
  ARS: { prefix: "AR$", digits: 0 },
  EUR: { prefix: "€", digits: 2 },
};

export function fmtMoney(v: number, currency: Currency, lang: "es" | "en"): string {
  const { prefix, digits } = STYLE[currency];
  const n = new Intl.NumberFormat(lang === "es" ? "es-US" : "en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(v));
  return `${v < 0 ? "−" : ""}${prefix} ${n}`;
}

/** A rate: units of `currency` per US dollar, where it came from and when. */
export interface FxRate {
  currency: Currency;
  perUsd: number;
  source: "FMP" | "DEMO" | "FIXED";
  asOf: string;
}

export const toUsd = (amount: number, rate: FxRate) => amount / rate.perUsd;
export const fromUsd = (usd: number, rate: FxRate) => usd * rate.perUsd;
