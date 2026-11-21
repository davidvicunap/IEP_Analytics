// Live-thesis alerts in words, for the page and for phone notifications (server side): plain
// functions over the core dictionary, no React.
import { fmtDate, fmtNum, fmtPrice, type Lang } from "./format";
import type { CoreDict } from "./i18n/es";
import { fill } from "./i18n/fill";
import type { SignalData, SignalKind } from "./thesis";

type T = CoreDict["thesis"];

export const pctText = (v: number, lang: Lang) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtNum(Math.abs(v), lang, 1)}%`;

/** The alert in one sentence, with the figures that raised it. */
export function alertText(a: { kind: SignalKind; data: SignalData }, T: T, lang: Lang): string {
  const d = a.data;
  const v = d.level !== undefined ? fmtPrice(d.level, lang) : "—";
  const p = d.price !== undefined ? fmtPrice(d.price, lang) : "—";
  switch (a.kind) {
    case "stop":
    case "target":
      return fill(T.alerts[a.kind], { v, p });
    case "fairValue":
      return fill(T.alerts.fairValue[d.op ?? "above"], { v, p });
    case "reviewBy":
      return fill(T.alerts.reviewBy, { d: d.date ? fmtDate(d.date, lang) : "—" });
    case "price":
      return fill(T.alerts.price[d.op ?? "below"], { v, p });
    case "move":
      return fill(T.alerts.move, { c: d.changePct !== undefined ? pctText(d.changePct, lang) : "—", x: fmtNum(d.pct ?? 0, lang, 2) });
    case "verdict":
      return fill(T.alerts.verdict, { a: d.area ? T.areas[d.area] : "—", n: d.now ? T.levels[d.now] : "—", m: d.min ? T.minsShort[d.min] : "—" });
    case "report":
      return fill(T.alerts.report, { f: d.form ?? "", d: d.filed ? fmtDate(d.filed, lang) : "—" });
    case "results":
      return fill(T.alerts.results, { d: d.date ? fmtDate(d.date, lang) : "—" });
  }
}

