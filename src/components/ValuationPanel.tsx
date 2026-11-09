"use client";

import { useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf } from "@/lib/format";
import type { ValuationPayload } from "@/lib/valuationData";
import { useResource } from "@/lib/useResource";
import { IssueNote, Panel } from "./ui";
import CompsView from "./valuation/CompsView";
import DcfMaker from "./valuation/DcfMaker";
import HistoryView from "./valuation/HistoryView";

type View = "comps" | "history" | "dcf";
const VIEWS: View[] = ["comps", "history", "dcf"];

/** Valuation screen: interactive comps, the company against its own history, and a DCF. */
export default function ValuationPanel({ symbol }: { symbol: string }) {
  const { t, lang } = useI18n();
  const [view, setView] = useState<View>("comps");
  const { state, retry } = useResource<ValuationPayload>(`/api/valuation/${encodeURIComponent(symbol)}`);

  const label = (k: View) => (k === "history" ? t.valuation.history.view : t.comps.views[k]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="section-title mr-auto">{t.valuation.title}</h2>
        <div role="group" aria-label={t.valuation.title} className="flex gap-1">
          {VIEWS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={view === k}
              onClick={() => setView(k)}
              className={`h-9 px-4 rounded-md text-[13px] font-medium border ${view === k ? "bg-panel-2 text-fg border-line-strong" : "border-transparent text-muted hover:text-fg hover:bg-panel-2"}`}
            >
              {label(k)}
            </button>
          ))}
        </div>
      </div>

      {view === "comps" && <CompsView symbol={symbol} />}

      {view !== "comps" &&
        (state.status === "loading" ? (
          <Panel>
            <p role="status" className="text-sm text-muted">{t.valuation.loading}</p>
            <div className="mt-3 h-64 rounded-lg bg-panel-2 animate-pulse" aria-hidden="true" />
          </Panel>
        ) : state.status === "error" ? (
          <Panel>
            <IssueNote issue={state.issue} onRetry={retry} />
          </Panel>
        ) : view === "history" ? (
          <HistoryView v={state.data} />
        ) : (
          <DcfMaker v={state.data} />
        ))}

      {state.status === "ok" && view !== "comps" && (
        <p className="text-[11px] text-muted">{fill(t.valuation.sources, { time: fmtAsOf(state.data.quoteAt, lang) })}</p>
      )}
    </div>
  );
}
