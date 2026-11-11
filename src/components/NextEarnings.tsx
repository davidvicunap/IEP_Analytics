"use client";

import { fill, useI18n } from "@/lib/i18n";
import { fmtDate, fmtPrice } from "@/lib/format";
import { daysUntil } from "@/lib/earnings";
import type { EarningsPayload } from "@/lib/earningsData";
import { useResource } from "@/lib/useResource";
import { CalendarIcon } from "./icons";

/** One line in the stock header: when the next results are due, and how we know. */
export default function NextEarnings({ symbol }: { symbol: string }) {
  const { t, lang } = useI18n();
  const E = t.stock.earnings;
  const { state } = useResource<EarningsPayload>(`/api/earnings/${encodeURIComponent(symbol)}`, { shared: true });
  // Secondary information: while loading or when no source answers, the line isn't shown.
  if (state.status !== "ok" || state.data.next.kind === "unknown") return null;
  const n = state.data.next;
  const today = new Date().toISOString().slice(0, 10);
  const days = daysUntil(n.date, today);
  const when = days <= 0 ? E.today : days === 1 ? E.tomorrow : fill(E.inDays, { n: days });
  const date = fmtDate(n.date, lang);
  return (
    <p className="mt-2 flex items-start gap-1.5 text-xs text-muted" data-earnings={n.kind}>
      <CalendarIcon size={14} className="mt-px" />
      <span>
        <span className="text-fg">{fill(n.kind === "listed" ? E.listed : E.estimated, { d: date })}</span> ({when})
        {n.kind === "listed" && n.epsEstimate !== null && ` · ${fill(E.eps, { v: fmtPrice(n.epsEstimate, lang) })}`}
        <span className="block sm:inline">
          {" "}
          {n.kind === "listed" ? E.listedNote : fill(E.estimatedNote, { b: fmtDate(n.basedOn, lang) })}
        </span>
      </span>
    </p>
  );
}
