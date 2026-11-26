"use client";

import Link from "next/link";
import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf } from "@/lib/format";
import type { CanvasDoc } from "@/lib/canvas";
import { useCanvases } from "@/lib/canvasClient";
import { useNotes } from "@/lib/researchClient";
import { isWatched } from "@/lib/thesis";
import { useHydrated } from "@/lib/watchlist";
import Companies from "./Companies";
import { RecentlyViewed } from "./Lists";
import { ThesisAlerts } from "./ThesisAlerts";
import PushSettings from "../PushSettings";
import TickerSearch from "../TickerSearch";
import { CanvasIcon, PlusIcon } from "../icons";
import { Skeleton, buttonClass } from "../ui";

/** Symbols a canvas shows, in the order they first appear. */
const symbolsOf = (c: CanvasDoc) => [...new Set(c.widgets.map((w) => w.symbol).filter((s): s is string => !!s))];

/**
 * The home page: your research. Search first (the one action that starts everything), then your
 * companies (theses, holdings and the ones you follow, each with what to know next), then your
 * canvases. No market tiles or popular stocks: this page is yours.
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
        <section aria-labelledby="hub-companies" className="min-w-0 lg:col-span-2">
          <h2 id="hub-companies" className="section-title">{H.companiesTitle}</h2>
          <Companies canvasFor={hydrated ? canvasFor : () => null} />
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
        </div>
      </div>

      <AlertChannels />
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

/** Where alerts reach you: only once something is being watched (a new reader has nothing to be alerted about). */
function AlertChannels() {
  const { state } = useNotes();
  const watching = state.status === "ok" && state.data.some(isWatched);
  return watching ? <PushSettings /> : null;
}
