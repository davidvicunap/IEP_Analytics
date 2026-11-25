"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtDate, fmtNum, fmtPrice } from "@/lib/format";
import type { CanvasDoc } from "@/lib/canvas";
import { fmtMoney } from "@/lib/money";
import { holdingLight, holdingReasons, totals, type Light, type Reason } from "@/lib/portfolio";
import { upside } from "@/lib/research";
import { useNotes, useTheses } from "@/lib/researchClient";
import { useSnapshots } from "@/lib/snapshotClient";
import { useSymbolInfo } from "@/lib/symbolsClient";
import { isWatched } from "@/lib/thesis";
import { book, positions, type Position } from "@/lib/trades";
import { useTrades } from "@/lib/tradesClient";
import { useQuotes } from "@/lib/useQuotes";
import { CanvasIcon } from "../icons";
import { signedPct } from "../research/ResearchPanel";
import { StatusBadge } from "../research/Thesis";
import { IssueNote, Provenance, Skeleton } from "../ui";

type Lang = "es" | "en";
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const signedUsd = (v: number, lang: Lang) => `${v > 0 ? "+" : ""}${fmtMoney(v, "USD", lang)}`;
const REASON_TONE: Record<Light, string> = { red: "text-down", amber: "text-warn", green: "text-muted", gray: "text-muted" };

/**
 * Every notebook, and every stock you hold, in one list: today's price next to your fair value,
 * what you own and what it's worth, the one thing to look at, and a way into its canvas.
 */
export default function Theses({ canvasFor }: { canvasFor: (symbol: string) => CanvasDoc | null }) {
  const { t, lang } = useI18n();
  const R = t.research;
  const H = t.hub;
  const notesRes = useNotes();
  const notes = notesRes.state.status === "ok" ? notesRes.state.data : notesRes.state.status === "loading" ? (notesRes.state.previous?.data ?? null) : null;
  const tradesRes = useTrades();
  const trades = tradesRes.state.status === "ok" ? tradesRes.state.data : tradesRes.state.status === "loading" ? (tradesRes.state.previous?.data ?? null) : null;
  const info = useSymbolInfo(useMemo(() => [...new Set((trades ?? []).map((x) => x.symbol))], [trades]));
  const open = useMemo(() => positions(book(trades ?? [], info.splits).open), [trades, info.splits]);
  const held = open.map((p) => p.symbol);

  // Notebooks first (in their order), then stocks you hold without one.
  const symbols = useMemo(() => {
    const own = (notes ?? []).map((n) => n.symbol);
    return [...own, ...held.filter((s) => !own.includes(s))];
  }, [notes, held]);
  const ready = !!notes && (!!trades || tradesRes.state.status === "error");
  const q = useQuotes(symbols, { enabled: ready && symbols.length > 0 });
  const price = (s: string) => q.items.find((i) => i.symbol === s)?.quote?.price ?? null;
  const theses = useTheses();
  const statusOf = (s: string) => (theses.state.status === "ok" ? theses.state.data.items.find((i) => i.symbol === s)?.status : undefined);
  const snaps = useSnapshots(held);
  const [today] = useState(localToday);

  if (notesRes.state.status === "error") return <IssueNote issue={notesRes.state.issue} onRetry={notesRes.retry} className="mt-3" />;
  if (!ready)
    return (
      <div className="mt-3 space-y-2" aria-busy="true">
        <p role="status" className="sr-only">{t.ux.loading}</p>
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );
  if (symbols.length === 0)
    return (
      <div className="mt-3 max-w-[64ch]">
        <p className="text-sm text-muted">{R.pageEmpty}</p>
        <h3 className="mt-5 text-sm font-semibold">{H.howTitle}</h3>
        <ol className="mt-2 space-y-2 text-[15px] leading-relaxed">
          {H.how.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="num w-5 shrink-0 text-muted">{i + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        {tradesRes.state.status === "error" && <IssueNote issue={tradesRes.state.issue} onRetry={tradesRes.retry} className="mt-4" />}
      </div>
    );

  const reasonsOf = (p: Position): Reason[] => {
    const note = notes!.find((n) => n.symbol === p.symbol);
    const snap = snaps.state[p.symbol];
    const filings = snap?.status === "ok" && snap.data.filings.ok ? snap.data.filings.data : null;
    return holdingReasons({
      position: p,
      price: price(p.symbol),
      stop: note?.closed ? null : (note?.stop ?? null),
      thesis: statusOf(p.symbol) ?? null,
      nextResults: filings?.nextResults?.date ?? null,
      lastReport: filings?.report ? { form: filings.report.form, filed: filings.report.filed } : null,
      listing: info.listing(p.symbol),
      today,
    });
  };
  const sum = totals(open.map((p) => ({ position: p, price: price(p.symbol) })));
  const pricedCost = sum.cost - open.filter((p) => price(p.symbol) === null).reduce((s, p) => s + p.cost, 0);
  const asOf = q.items.map((i) => i.fetchedAt).filter((x): x is string => !!x).sort().at(-1);

  return (
    <>
      {open.length > 0 && (
        <p className="num mt-2 text-sm" data-testid="holdings-total">
          {q.loading ? (
            <span className="text-muted">{t.ux.loading}</span>
          ) : (
            <>
              {fill(open.length === 1 ? H.heldOne : H.held, { n: open.length, v: fmtMoney(sum.value, "USD", lang) })}{" "}
              <span className={sum.gain > 0 ? "text-up" : sum.gain < 0 ? "text-down" : "text-muted"}>
                {signedUsd(sum.gain, lang)} ({pricedCost > 0 ? signedPct(sum.gain / pricedCost, lang) : "—"})
              </span>
              {sum.unpriced > 0 && <span className="text-muted"> · {fill(t.portfolio.unpriced, { n: sum.unpriced })}</span>}
            </>
          )}
        </p>
      )}
      {tradesRes.state.status === "error" && <IssueNote issue={tradesRes.state.issue} onRetry={tradesRes.retry} className="mt-2" />}
      <ul className="mt-2 divide-y divide-line border-y border-line" data-testid="theses">
        {symbols.map((s) => {
          const n = notes!.find((x) => x.symbol === s);
          const pos = open.find((p) => p.symbol === s);
          const p = price(s);
          const gap = n ? upside(n.fairValue, p) : null;
          const canvas = canvasFor(s);
          const status = n?.closed ? "closed" : n && isWatched(n) ? statusOf(s) : undefined;
          return (
            <li key={s} className="flex items-start gap-2 py-1" data-testid={`thesis-${s}`}>
              <Link
                href={`/stock/${encodeURIComponent(s)}?tab=research`}
                prefetch={false}
                className="-ml-2 flex min-w-0 flex-1 flex-col gap-1 rounded-lg px-2 py-2.5 hover:bg-panel-2 sm:flex-row sm:items-start sm:gap-4"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{s}</span>
                    {status && <StatusBadge status={status} />}
                  </span>
                  <span className={`mt-0.5 block line-clamp-2 text-sm leading-relaxed ${n?.thesis ? "" : "text-muted"}`}>{n?.thesis || R.noThesis}</span>
                  {pos && <Holding p={pos} price={p} reasons={reasonsOf(pos)} lang={lang} />}
                </span>
                <span className="num grid grid-cols-3 gap-3 text-sm sm:w-80 sm:text-right">
                  <span>
                    <span className="block text-xs text-muted">{R.cols.fair}</span>
                    {n?.fairValue == null ? "—" : fmtPrice(n.fairValue, lang)}
                  </span>
                  <span>
                    <span className="block text-xs text-muted">{R.cols.price}</span>
                    {p === null ? "—" : fmtPrice(p, lang)}
                  </span>
                  <span>
                    <span className="block text-xs text-muted">{R.cols.gap}</span>
                    {gap === null ? "—" : signedPct(gap, lang)}
                  </span>
                </span>
              </Link>
              <Link
                href={canvas ? `/canvas?c=${encodeURIComponent(canvas.id)}` : `/canvas?new=1&s=${encodeURIComponent(s)}`}
                prefetch={false}
                title={canvas ? fill(H.openCanvasTitle, { s }) : fill(H.newCanvasFor, { s })}
                aria-label={canvas ? fill(H.openCanvasTitle, { s }) : fill(H.newCanvasFor, { s })}
                className="mt-1.5 inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-muted hover:bg-panel-2 hover:text-fg sm:h-9"
              >
                <CanvasIcon size={15} />
                <span className="hidden sm:inline">{H.openCanvas}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {q.source && <Provenance source={q.source} asOf={asOf} stale={q.items.some((i) => i.stale)} className="mt-2" />}
      {open.length === 0 && <p className="mt-3 max-w-[64ch] text-xs text-muted">{H.addHolding}</p>}
    </>
  );
}

/** What you own of it, what it's worth now and the one thing to look at. */
function Holding({ p, price, reasons, lang }: { p: Position; price: number | null; reasons: Reason[]; lang: Lang }) {
  const { t } = useI18n();
  const P = t.portfolio;
  const gain = price === null ? null : p.shares * price - p.cost;
  const top = reasons[0];
  const light = holdingLight(reasons);
  return (
    <span className="mt-1 block text-[13px]" data-testid={`holding-${p.symbol}`}>
      <span className="num block text-muted">
        {fill(P.position, { n: fmtNum(p.shares, lang, 6), w: p.shares === 1 ? P.shareWord.one : P.shareWord.many, c: fmtMoney(p.avgPrice, "USD", lang) })}
        {price !== null && (
          <>
            {" · "}
            {fmtMoney(p.shares * price, "USD", lang)}{" "}
            <span className={gain! > 0 ? "text-up" : gain! < 0 ? "text-down" : ""}>
              {signedUsd(gain!, lang)} ({signedPct(gain! / p.cost, lang)})
            </span>
          </>
        )}
      </span>
      {top && top.kind !== "ok" && (
        <span className={`block ${REASON_TONE[light]}`}>
          <span className="sr-only">{P.light[light]}: </span>
          {reasonText(top, P, lang)}
        </span>
      )}
    </span>
  );
}

function reasonText(r: Reason, P: ReturnType<typeof useI18n>["t"]["portfolio"], lang: Lang): string {
  const R = P.reason;
  switch (r.kind) {
    case "delisted":
      return R.delisted;
    case "renamed":
      return fill(R.renamed, { to: r.to });
    case "noPrice":
      return R.noPrice;
    case "belowStop":
      return fill(R.belowStop, { s: fmtMoney(r.stop, "USD", lang) });
    case "atRisk":
      return R.atRisk;
    case "results":
      return r.days === 0 ? R.resultsToday : r.days === 1 ? R.resultsTomorrow : fill(R.resultsDays, { n: r.days, d: fmtDate(r.date, lang) });
    case "nearStop":
      return fill(R.nearStop, { p: `${fmtNum(r.gap * 100, lang, 1)}%`, s: fmtMoney(r.stop, "USD", lang) });
    case "report":
      return fill(R.report, { f: r.form, d: fmtDate(r.filed, lang) });
    case "noExit":
      return R.noExit;
    case "ok":
      return fill(R.ok, { s: fmtMoney(r.stop, "USD", lang), p: `${fmtNum(r.gap * 100, lang, 1)}%` });
  }
}
