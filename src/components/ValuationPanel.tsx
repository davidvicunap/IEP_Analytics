"use client";

import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf } from "@/lib/format";
import type { ValuationPayload } from "@/lib/valuationData";
import { useResource } from "@/lib/useResource";
import { IssueNote, Panel, Segmented } from "./ui";
import CompsView from "./valuation/CompsView";
import HistoryView from "./valuation/HistoryView";
import PriceImplies from "./valuation/PriceImplies";

export type View = "comps" | "history";
const VIEWS: View[] = ["comps", "history"];

/** Valuation screen: what the price implies, interactive comps and the company against its own history. */
/** The view lives in the URL (`?view=`), so a link (or the command palette) can open it. */
export default function ValuationPanel({ symbol, view, onView: setView }: { symbol: string; view: View; onView: (v: View) => void }) {
  const { t, lang } = useI18n();
  const { state, retry } = useResource<ValuationPayload>(`/api/valuation/${encodeURIComponent(symbol)}`);

  const label = (k: View) => (k === "history" ? t.valuation.history.view : t.comps.views[k]);

  return (
    <div className="space-y-6">
      {/* The same view switch as the other tabs: left-aligned under the tabs, no second title. */}
      <Segmented label={t.valuation.title} value={view} onChange={setView} options={VIEWS.map((k) => ({ value: k, label: label(k) }))} />

      {state.status === "ok" && <PriceImplies v={state.data} />}

      {view === "comps" && <CompsView symbol={symbol} />}

      {view === "history" &&
        (state.status === "loading" ? (
          <Panel>
            <p role="status" className="text-sm text-muted">{t.valuation.loading}</p>
            <div className="mt-3 h-64 rounded-lg bg-panel-2 animate-pulse" aria-hidden="true" />
          </Panel>
        ) : state.status === "error" ? (
          <Panel>
            <IssueNote issue={state.issue} onRetry={retry} />
          </Panel>
        ) : (
          <HistoryView v={state.data} />
        ))}

      {state.status === "ok" && view === "history" && (
        <p className="text-[11px] text-muted">{fill(t.valuation.sources, { time: fmtAsOf(state.data.quoteAt, lang) })}</p>
      )}
    </div>
  );
}
