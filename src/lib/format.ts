export type Lang = "es" | "en";

const locale = (lang: Lang) => (lang === "es" ? "es-US" : "en-US");

export function fmtPrice(v: number | undefined, lang: Lang): string {
  if (v === undefined) return "—";
  return new Intl.NumberFormat(locale(lang), { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(v);
}

export function fmtPct(v: number | undefined, lang: Lang, opts: { sign?: boolean; fraction?: boolean } = {}): string {
  if (v === undefined) return "—";
  const n = opts.fraction ? v * 100 : v;
  const s = new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n);
  return `${opts.sign && n > 0 ? "+" : ""}${s}%`;
}

export function fmtNum(v: number | undefined, lang: Lang, digits = 2): string {
  if (v === undefined) return "—";
  return new Intl.NumberFormat(locale(lang), { maximumFractionDigits: digits }).format(v);
}

/** 1.2T / 345B / 12M style. Always K/M/B/T: Spanish "B" (billón) would mean 10^12. */
export function fmtBig(v: number | undefined, _lang?: Lang): string {
  if (v === undefined) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v);
}

export function fmtDate(iso: string, lang: Lang): string {
  const d = new Date(iso.includes("T") || iso.includes(" ") ? iso.replace(" ", "T") : iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale(lang), { dateStyle: "medium" }).format(d);
}
