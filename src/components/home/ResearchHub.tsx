"use client";

import Link from "next/link";
import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtPrice } from "@/lib/format";
import type { CanvasDoc } from "@/lib/canvas";
import { useCanvases } from "@/lib/canvasClient";
import { upside } from "@/lib/research";
import { useNotes, useTheses } from "@/lib/researchClient";
import { isWatched } from "@/lib/thesis";
import { useQuotes } from "@/lib/useQuotes";
import { useHydrated } from "@/lib/watchlist";
import { ThesisAlerts } from "../Briefing";
import { MiniWatchlist, RecentlyViewed } from "../HomeView";
import PushSettings from "../PushSettings";
import TickerSearch from "../TickerSearch";
import { CanvasIcon, PlusIcon } from "../icons";
import { signedPct } from "../research/ResearchPanel";
import { StatusBadge } from "../research/Thesis";
import { IssueNote, Skeleton, buttonClass } from "../ui";

/** Symbols a canvas shows, in the order they first appear. */
const symbolsOf = (c: CanvasDoc) => [...new Set(c.widgets.map((w) => w.symbol).filter((s): s is string => !!s))];

/**
 * The home page: your research. Search first (the one action that starts everything), then the
 * theses with today's price beside your fair value, then your canvases; the list and the
 * portfolio come after, as context. No market tiles or popular stocks: this page is yours.
 */
export default function ResearchHub() {
  const { t } = useI18n();
  const H = t.hub;
  const hydrated = useHydrated();
  const canvases = useCanvases();
  const sorted = [...canvases].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const canvasFor = (symbol: string) => sorted.find((c) => symbolsOf(c).includes(symbol)) ?? null;

  return (
    <div className="space-y-10 pt-2 sm:pt-6">
      <section aria-labelledby="hub-title" className="max-w-2xl">
        <h1 id="hub-title" className="text-[30px] font-semibold leading-tight tracking-[-0.02em] sm:text-[36px]">
          {H.title}
        </h1>
        <p className="mt-2 max-w-[60ch] text-[15px] leading-relaxed text-muted">{H.intro}</p>
        <div className="mt-5">
          <TickerSearch large />
        </div>
        <RecentlyViewed />
      </section>

      <ThesisAlerts title={H.alertsTitle} />

      <div className="grid gap-10 lg:grid-cols-3 lg:gap-12">
        <section aria-labelledby="hub-theses" className="min-w-0 lg:col-span-2">
          <h2 id="hub-theses" className="section-title">{H.thesesTitle}</h2>
          <Theses canvasFor={hydrated ? canvasFor : () => null} />
        </section>

        <div className="min-w-0 space-y-10">
          <section aria-labelledby="hub-canvases">
            <div className="flex items-center justify-between gap-3">
              <h2 id="hub-canvases" className="section-title">{H.canvasesTitle}</h2>
              <Link href="/canvas?new=1" prefetch={false} className={buttonClass("secondary", true)}>
                <PlusIcon size={15} />
                {H.newCanvas}
              </Link>
            </div>
            {!hydrated ? (
              <Skeleton className="mt-3 h-24" />
            ) : sorted.length === 0 ? (
              <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-muted">{H.canvasesEmpty}</p>
            ) : (
              <ul className="mt-2 divide-y divide-line border-y border-line">
                {sorted.map((c) => (
                  <CanvasRow key={c.id} canvas={c} />
                ))}
              </ul>
            )}
          </section>
          <MiniWatchlist />
        </div>
      </div>

      <p className="text-sm text-muted">
        {(() => {
          const [before, after] = H.portfolio.split("{link}");
          return (
            <>
              {before}
              <Link href="/portfolio" className="link">
                {H.portfolioLink}
              </Link>
              {after}
            </>
          );
        })()}
      </p>

      <PushSettings />
      <p className="text-xs text-muted">{t.research.disclaimer}</p>
    </div>
  );
}

function CanvasRow({ canvas }: { canvas: CanvasDoc }) {
  const { t, lang } = useI18n();
  const H = t.hub;
  const syms = symbolsOf(canvas);
  const n = canvas.widgets.length;
  return (
    <li>
      <Link href={`/canvas?c=${encodeURIComponent(canvas.id)}`} prefetch={false} className="-mx-2 flex min-h-11 items-start gap-3 rounded-lg px-2 py-3 hover:bg-panel-2">
        <CanvasIcon size={16} className="mt-0.5 shrink-0 text-muted" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{canvas.name}</span>
          <span className="num mt-0.5 block truncate text-xs text-muted">
            {[syms.slice(0, 4).join(" · "), n === 1 ? H.windowsOne : fill(H.windows, { n }), fmtAsOf(canvas.updatedAt, lang)].filter(Boolean).join(" — ")}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** Every notebook, with today's price next to the fair value and a way into its canvas. */
function Theses({ canvasFor }: { canvasFor: (symbol: string) => CanvasDoc | null }) {
  const { t, lang } = useI18n();
  const R = t.research;
  const H = t.hub;
  const { state, retry } = useNotes();
  const notes = state.status === "ok" ? state.data : state.status === "loading" ? (state.previous?.data ?? null) : null;
  const q = useQuotes((notes ?? []).map((n) => n.symbol), { enabled: !!notes && notes.length > 0 });
  const price = (s: string) => q.items.find((i) => i.symbol === s)?.quote?.price ?? null;
  const theses = useTheses();
  const statusOf = (s: string) => (theses.state.status === "ok" ? theses.state.data.items.find((i) => i.symbol === s)?.status : undefined);

  if (state.status === "error") return <IssueNote issue={state.issue} onRetry={retry} className="mt-3" />;
  if (!notes)
    return (
      <div className="mt-3 space-y-2" aria-busy="true">
        <p role="status" className="sr-only">{t.ux.loading}</p>
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );
  if (notes.length === 0)
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
      </div>
    );

  return (
    <ul className="mt-2 divide-y divide-line border-y border-line">
      {notes.map((n) => {
        const p = price(n.symbol);
        const gap = upside(n.fairValue, p);
        const canvas = canvasFor(n.symbol);
        return (
          <li key={n.symbol} className="flex items-start gap-2 py-1">
            <Link
              href={`/stock/${encodeURIComponent(n.symbol)}?tab=research`}
              prefetch={false}
              className="-ml-2 flex min-w-0 flex-1 flex-col gap-1 rounded-lg px-2 py-2.5 hover:bg-panel-2 sm:flex-row sm:items-start sm:gap-4"
            >
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{n.symbol}</span>
                  {n.closed ? <StatusBadge status="closed" /> : isWatched(n) && statusOf(n.symbol) ? <StatusBadge status={statusOf(n.symbol)!} /> : null}
                </span>
                <span className={`mt-0.5 block line-clamp-2 text-sm leading-relaxed ${n.thesis ? "" : "text-muted"}`}>{n.thesis || R.noThesis}</span>
              </span>
              <span className="num grid grid-cols-3 gap-3 text-sm sm:w-80 sm:text-right">
                <span>
                  <span className="block text-xs text-muted">{R.cols.fair}</span>
                  {n.fairValue === null ? "—" : fmtPrice(n.fairValue, lang)}
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
              href={canvas ? `/canvas?c=${encodeURIComponent(canvas.id)}` : `/canvas?new=1&s=${encodeURIComponent(n.symbol)}`}
              prefetch={false}
              title={canvas ? fill(H.openCanvasTitle, { s: n.symbol }) : fill(H.newCanvasFor, { s: n.symbol })}
              aria-label={canvas ? fill(H.openCanvasTitle, { s: n.symbol }) : fill(H.newCanvasFor, { s: n.symbol })}
              className="mt-1.5 inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-muted hover:bg-panel-2 hover:text-fg sm:h-9"
            >
              <CanvasIcon size={15} />
              <span className="hidden sm:inline">{H.openCanvas}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
