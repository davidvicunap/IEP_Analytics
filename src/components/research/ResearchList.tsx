"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtPrice } from "@/lib/format";
import { upside } from "@/lib/research";
import { useNotes } from "@/lib/researchClient";
import { useQuotes } from "@/lib/useQuotes";
import { EmptyState, IssueNote, Panel, Skeleton } from "../ui";
import { signedPct } from "./ResearchPanel";

/** Every notebook the user has started, with today's price next to their fair value. */
export default function ResearchList() {
  const { t, lang } = useI18n();
  const R = t.research;
  const { state, retry } = useNotes();
  const notes = state.status === "ok" ? state.data : state.status === "loading" ? (state.previous?.data ?? null) : null;
  const q = useQuotes((notes ?? []).map((n) => n.symbol), { enabled: !!notes && notes.length > 0 });
  const price = (s: string) => q.items.find((i) => i.symbol === s)?.quote?.price ?? null;

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] leading-tight">{R.pageTitle}</h1>
        <p className="mt-1 text-[15px] text-muted">{R.pageIntro}</p>
      </div>
      <Panel>
        {state.status === "error" ? (
          <IssueNote issue={state.issue} onRetry={retry} />
        ) : !notes ? (
          <>
            <p role="status" className="sr-only">{t.ux.loading}</p>
            <Skeleton className="h-40 w-full rounded-lg" />
          </>
        ) : notes.length === 0 ? (
          <EmptyState title={R.pageTitle}>{R.pageEmpty}</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {notes.map((n) => {
              const p = price(n.symbol);
              const gap = upside(n.fairValue, p);
              return (
                <li key={n.symbol}>
                  <Link
                    href={`/stock/${encodeURIComponent(n.symbol)}?tab=research`}
                    prefetch={false}
                    className="-mx-2 flex flex-col gap-1 rounded-lg px-2 py-3 hover:bg-panel-2 sm:flex-row sm:items-start sm:gap-4"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{n.symbol}</span>
                      <span className={`mt-0.5 block line-clamp-2 text-sm ${n.thesis ? "" : "text-muted"}`}>{n.thesis || R.noThesis}</span>
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
                    <span className="text-xs text-muted sm:w-28 sm:text-right sm:pt-0.5">
                      <span className="sr-only">{R.cols.updated}: </span>
                      {n.updatedAt && fmtAsOf(n.updatedAt, lang)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <p className="text-xs text-muted">{R.disclaimer}</p>
    </div>
  );
}
