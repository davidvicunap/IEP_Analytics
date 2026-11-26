"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtDate, fmtNum, fmtPrice } from "@/lib/format";
import type { CanvasDoc } from "@/lib/canvas";
import { companyRows, nextEvent, type NextEvent } from "@/lib/companies";
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
import { useHydrated, useWatchlist } from "@/lib/watchlist";
import { CanvasIcon } from "../icons";
import SyncNote from "../SyncNote";
import { signedPct } from "../research/ResearchPanel";
import { StatusBadge } from "../research/Thesis";
import { Change, IssueNote, Provenance, Skeleton, StatusMessage } from "../ui";

type Lang = "es" | "en";
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const signedUsd = (v: number, lang: Lang) => `${v > 0 ? "+" : ""}${fmtMoney(v, "USD", lang)}`;
const REASON_TONE: Record<Light, string> = { red: "text-down", amber: "text-warn", green: "text-muted", gray: "text-muted" };

/**
 * Your companies: every notebook, every stock you hold and every one you follow, in one list.
 * Today's price next to your fair value, what you own and what it's worth, the next thing to
 * know (an alert, a new filing, results soon) and a way into its canvas.
 */
export default function Companies({ canvasFor }: { canvasFor: (symbol: string) => CanvasDoc | null }) {
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

  const followed = useWatchlist().list;
  const hydrated = useHydrated();
  // Notebooks first (in their order), then stocks held without one, then those only followed.
  const rows = useMemo(() => companyRows({ notes: (notes ?? []).map((n) => n.symbol), held, followed }), [notes, held, followed]);
  const symbols = useMemo(() => rows.map((r) => r.symbol), [rows]);
  const ready = !!notes && (!!trades || tradesRes.state.status === "error") && hydrated;
  const q = useQuotes(symbols, { enabled: ready && symbols.length > 0 });
  const price = (s: string) => q.items.find((i) => i.symbol === s)?.quote?.price ?? null;
  const theses = useTheses();
  const statusOf = (s: string) => (theses.state.status === "ok" ? theses.state.data.items.find((i) => i.symbol === s)?.status : undefined);
  const unseenAlerts = (s: string) => (theses.state.status === "ok" ? (theses.state.data.items.find((i) => i.symbol === s)?.alerts.filter((a) => !a.dismissedAt).length ?? 0) : 0);
  const snaps = useSnapshots(symbols);
  const quoteOf = (s: string) => q.items.find((i) => i.symbol === s)?.quote ?? null;
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
  const missing = q.loading ? 0 : q.items.filter((i) => !i.quote && i.error).length;

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
      {/* Column names once, above the list; each value also carries its name for screen readers. */}
      <div className="mt-3 hidden items-end gap-2 pb-2 text-xs text-muted sm:flex" aria-hidden="true">
        <span className="flex-1" />
        <span className="num flex gap-4 pr-2 text-right">
          <span className="w-24">{R.cols.fair}</span>
          <span className="w-24">{R.cols.price}</span>
          <span className="w-16">{R.cols.gap}</span>
        </span>
        <span className="w-9" />
      </div>
      <ul className="mt-2 divide-y divide-line border-y border-line sm:mt-0" data-testid="companies">
        {rows.map(({ symbol: s, followed: isFollowed }) => {
          const n = notes!.find((x) => x.symbol === s);
          const pos = open.find((p) => p.symbol === s);
          const quote = quoteOf(s);
          const p = quote?.price ?? null;
          const gap = n ? upside(n.fairValue, p) : null;
          const canvas = canvasFor(s);
          const status = n?.closed ? "closed" : n && isWatched(n) ? statusOf(s) : undefined;
          const snap = snaps.state[s];
          const filings = snap?.status === "ok" && snap.data.filings.ok ? snap.data.filings.data : null;
          // Held stocks say what matters about the position; the rest, the next thing to know.
          const next = pos ? null : nextEvent({ alerts: unseenAlerts(s), recent: filings?.recent ?? [], nextResults: filings?.nextResults ?? null, today });
          const canvasLabel = canvas ? fill(H.openCanvasTitle, { s }) : fill(H.newCanvasFor, { s });
          return (
            <li key={s} className="group flex items-start gap-2" data-testid={`company-${s}`}>
              <Link
                href={n || pos ? `/stock/${encodeURIComponent(s)}?tab=research` : `/stock/${encodeURIComponent(s)}`}
                prefetch={false}
                className="-ml-2 flex min-w-0 flex-1 items-start gap-4 rounded-lg px-2 py-3 hover:bg-panel-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold">{s}</span>
                    {status && <StatusBadge status={status} />}
                    {!n && !pos && isFollowed && <span className="text-xs text-muted">{H.following}</span>}
                  </span>
                  <span className={`mt-0.5 block line-clamp-2 text-sm leading-relaxed ${n?.thesis ? "" : "text-muted"}`}>
                    {n?.thesis || (n || pos ? R.noThesis : (quote?.name ?? H.noThesisYet))}
                  </span>
                  {/* Phones: your fair value, when you set one, sits under the name instead of a column. */}
                  {n?.fairValue != null && (
                    <span className="num mt-1 block text-[13px] text-muted sm:hidden">
                      {R.cols.fair} {fmtPrice(n.fairValue, lang)}
                      {gap !== null && ` · ${signedPct(gap, lang)}`}
                    </span>
                  )}
                  {pos && <Holding p={pos} price={p} reasons={reasonsOf(pos)} lang={lang} />}
                  {next && <NextLine event={next} lang={lang} />}
                </span>
                <span className="num flex shrink-0 gap-4 text-right text-sm">
                  <span className="hidden w-24 sm:block">
                    <span className="sr-only">{R.cols.fair}: </span>
                    {n?.fairValue == null ? <span className="text-muted">—</span> : fmtPrice(n.fairValue, lang)}
                  </span>
                  <span className="w-24">
                    <span className="sr-only">{R.cols.price}: </span>
                    {p === null ? <span className="text-muted">—</span> : <span className="font-medium">{fmtPrice(p, lang)}</span>}
                    {quote && <span className="block"><Change pct={quote.changePercent} className="text-xs" /></span>}
                  </span>
                  <span className="hidden w-16 sm:block">
                    <span className="sr-only">{R.cols.gap}: </span>
                    {gap === null ? <span className="text-muted">—</span> : signedPct(gap, lang)}
                  </span>
                </span>
              </Link>
              {/* Into its canvas. With a mouse it shows on the row you're on; on touch it's always there. */}
              <Link
                href={canvas ? `/canvas?c=${encodeURIComponent(canvas.id)}` : `/canvas?new=1&s=${encodeURIComponent(s)}`}
                prefetch={false}
                title={canvasLabel}
                aria-label={canvasLabel}
                className="mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted transition-opacity duration-150 hover:bg-panel-2 hover:text-fg focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 pointer-fine:opacity-0 sm:mt-1.5 sm:h-9 sm:w-9"
              >
                <CanvasIcon size={16} />
              </Link>
            </li>
          );
        })}
      </ul>
      {q.issue ? (
        <StatusMessage tone="warn" className="mt-3">
          {t.ux.requestIssues[q.issue]}{" "}
          {q.issue === "beta_expired" && (
            <a href="/beta?next=%2F" className="link">
              {t.ux.signInAgain}
            </a>
          )}
        </StatusMessage>
      ) : (
        missing > 0 && <p className="mt-2 text-xs text-muted">{fill(t.ux.partial, { n: missing, total: symbols.length })}</p>
      )}
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {q.source && <Provenance source={q.source} asOf={asOf} stale={q.items.some((i) => i.stale)} />}
        {/* The followed list is saved to your account: say where it is right now. */}
        {followed.length > 0 && <SyncNote className="text-xs" />}
      </div>
      {open.length === 0 && <p className="mt-3 max-w-[64ch] text-xs text-muted">{H.addHolding}</p>}
    </>
  );
}

/** The next thing to know about a stock you don't hold: an alert, a new filing, results soon. */
function NextLine({ event: e, lang }: { event: NextEvent; lang: Lang }) {
  const { t } = useI18n();
  const N = t.hub.next;
  const text =
    e.kind === "alert"
      ? e.count === 1
        ? N.alertOne
        : fill(N.alerts, { n: e.count })
      : e.kind === "filed"
        ? fill(N.filed, { f: e.form, d: fmtDate(e.filed, lang) })
        : e.days === 0
          ? N.resultsToday
          : e.days === 1
            ? N.resultsTomorrow
            : fill(N.results, { d: fmtDate(e.date, lang), n: e.days });
  return (
    <span className={`mt-1 block text-[13px] ${e.kind === "alert" ? "text-warn" : "text-muted"}`} data-next={e.kind}>
      {text}
    </span>
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
