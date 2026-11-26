"use client";

import { useI18n } from "@/lib/i18n";
import { fmtAsOf } from "@/lib/format";
import { findings } from "@/lib/financialsView";
import { findingText } from "./FinancialHighlights";
import { useFinancials } from "./financialsHooks";
import { ChevronRightIcon } from "./icons";
import { IssueNote, Panel, Skeleton } from "./ui";

const SHOWN = 3;

/**
 * The financials' first three findings in plain words (growth, margin, cash), from the 10-Ks,
 * with the way into the full "Lo esencial". Shown on the overview and in canvas windows.
 */
export default function HighlightsCard({ symbol, onOpen }: { symbol: string; onOpen?: () => void }) {
  const { t, lang } = useI18n();
  const hl = t.fin.hl;
  const { state, retry } = useFinancials(symbol);
  const title = t.stock.views.highlights;

  if (state.status === "loading")
    return (
      <Panel bare className="lg:pt-6" title={title} id="highlights-card">
        <div className="space-y-2" aria-busy="true">
          <p role="status" className="sr-only">{t.fin.loading}</p>
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-10/12" />
          <Skeleton className="h-4 w-9/12" />
        </div>
      </Panel>
    );
  if (state.status === "error")
    return (
      <Panel bare className="lg:pt-6" title={title} id="highlights-card">
        <IssueNote issue={state.issue} onRetry={retry} />
      </Panel>
    );

  const found = findings(state.data.annual).slice(0, SHOWN);
  return (
    <Panel bare className="lg:pt-6" title={title} id="highlights-card">
      {found.length === 0 ? (
        <p className="text-sm text-muted">{hl.noHistory}</p>
      ) : (
        <ul className="space-y-2.5">
          {found.map((f) => (
            <li key={f.kind} className="text-sm leading-relaxed">
              {findingText(f, hl, lang)}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-[11px] text-muted">
          {hl.source} · <time dateTime={state.fetchedAt}>{fmtAsOf(state.fetchedAt, lang)}</time>
        </p>
        {onOpen && (
          <button type="button" onClick={onOpen} className="link inline-flex min-h-11 items-center gap-0.5 text-[13px] sm:min-h-0">
            {hl.cardMore}
            <ChevronRightIcon size={14} />
          </button>
        )}
      </div>
    </Panel>
  );
}
