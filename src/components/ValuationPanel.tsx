"use client";

import { useEffect, useMemo, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtBig, fmtDate, fmtNum, fmtPrice } from "@/lib/format";
import type { MultipleRow, ValuationPayload } from "@/lib/valuationData";
import type { MultipleKey } from "@/lib/valuation";
import type { DataIssue, Result } from "@/lib/types";
import { Comparison, Explain, IssueNote, Panel } from "./ui";
import CompsView from "./valuation/CompsView";
import DcfMaker from "./valuation/DcfMaker";

type Lang = "es" | "en";
type View = "comps" | "dcf";
const pct = (v: number, lang: Lang, digits = 1) => `${fmtNum(v * 100, lang, digits)}%`;
const money = (v: number) => (v < 0 ? `−$${fmtBig(-v)}` : `$${fmtBig(v)}`);

function fmtMultiple(key: MultipleKey, v: number | null | undefined, lang: Lang): string {
  if (v === null || v === undefined) return "—";
  return key === "fcfYield" ? pct(v, lang) : `${fmtNum(v, lang, 1)}x`;
}

/** Descriptive tag from the history percentile; turned around for yields. */
export function historyTag(m: Pick<MultipleRow, "own" | "higherIsCheaper">): "cheap" | "expensive" | null {
  if (!m.own) return null;
  const p = m.higherIsCheaper ? 100 - m.own.percentile : m.own.percentile;
  return p >= 80 ? "expensive" : p <= 20 ? "cheap" : null;
}

/** Valuation screen: interactive comps and a DCF the user fills in. */
export default function ValuationPanel({ symbol }: { symbol: string }) {
  const { t, lang } = useI18n();
  const [view, setView] = useState<View>("comps");
  const [state, setState] = useState<Result<ValuationPayload> | null>(null);

  useEffect(() => {
    let alive = true;
    setState(null);
    fetch(`/api/valuation/${encodeURIComponent(symbol)}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as Result<ValuationPayload> | null;
        if (alive) setState(body ?? { ok: false, error: "upstream" });
      })
      .catch(() => alive && setState({ ok: false, error: "upstream" }));
    return () => {
      alive = false;
    };
  }, [symbol]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mr-auto">{t.valuation.title}</h2>
        <div role="group" aria-label={t.valuation.title} className="flex gap-1">
          {(["comps", "dcf"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={view === k}
              onClick={() => setView(k)}
              className={`h-9 px-4 rounded-md text-xs font-semibold border ${view === k ? "bg-accent text-accent-fg border-accent" : "border-line bg-panel hover:bg-panel-2"}`}
            >
              {t.comps.views[k]}
            </button>
          ))}
        </div>
      </div>

      {view === "comps" && (
        <>
          <CompsView symbol={symbol} />
          <HistorySection state={state} lang={lang} />
        </>
      )}

      {view === "dcf" &&
        (state === null ? (
          <Panel>
            <p role="status" className="text-sm text-muted">{t.valuation.loading}</p>
            <div className="mt-3 h-64 rounded-lg bg-panel-2 animate-pulse" aria-hidden="true" />
          </Panel>
        ) : !state.ok ? (
          <Panel>
            <IssueNote issue={state.error as DataIssue} />
          </Panel>
        ) : (
          <DcfMaker v={state.data} />
        ))}

      {state?.ok && <p className="text-[11px] text-muted">{fill(t.valuation.sources, { time: fmtAsOf(state.data.quoteAt, lang) })}</p>}
    </div>
  );
}

/** Today's multiples against the company's own last 5 years (collapsed by default). */
function HistorySection({ state, lang }: { state: Result<ValuationPayload> | null; lang: Lang }) {
  const { t } = useI18n();
  const shown = useMemo(() => (state?.ok ? state.data.multiples.filter((m) => m.applicable) : []), [state]);
  if (!state?.ok) return null;
  const v = state.data;
  const historyIssue =
    v.history.issue && v.history.issue in t.valuation.historyIssues
      ? t.valuation.historyIssues[v.history.issue as keyof typeof t.valuation.historyIssues]
      : null;
  return (
    <details className="rounded-xl border border-line bg-panel p-4">
      <summary className="cursor-pointer select-none text-sm font-medium min-h-8 flex items-center">{t.comps.historyTitle}</summary>
      <div className="mt-3">
        {v.ttm && (
          <p className="text-xs text-muted mb-3">
            {fill(t.valuation.basis, { price: fmtPrice(v.price, lang), cap: money(v.marketCap), ttm: v.ttm.label })}
          </p>
        )}
        {historyIssue && <p className="mb-3 text-xs text-muted">{historyIssue}</p>}
        {v.history.issue && !historyIssue && <IssueNote issue={v.history.issue as DataIssue} className="mb-3" />}
        <div className="grid gap-3 sm:grid-cols-2">
          {shown.map((m) => (
            <MultipleCard key={m.key} m={m} v={v} lang={lang} />
          ))}
        </div>
      </div>
    </details>
  );
}

function MultipleCard({ m, v, lang }: { m: MultipleRow; v: ValuationPayload; lang: Lang }) {
  const { t } = useI18n();
  const tag = historyTag(m);
  return (
    <article className="rounded-lg border border-line bg-panel p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium">{t.valuation.names[m.key]}</h3>
        {tag && <span className="rounded-full bg-info-bg text-info px-2 py-0.5 text-[11px] font-semibold">{t.valuation.tags[tag]}</span>}
      </div>
      <p className={`num text-2xl font-semibold ${m.value !== null && m.value < 0 ? "text-down" : ""}`}>{fmtMultiple(m.key, m.value, lang)}</p>
      <p className="text-[11px] text-muted">= {t.valuation.formulas[m.key]}</p>
      {m.note && <p className="text-xs text-warn">{t.valuation.notes[m.note]}</p>}
      {m.value !== null && (m.own || m.peers) && (
        <dl className="space-y-2 text-xs">
          {m.own && (
            <Comparison
              label={t.valuation.vsHistory}
              percentile={m.own.percentile}
              text={fill(t.valuation.historyText, {
                p: m.own.percentile,
                from: fmtDate(m.own.from, lang),
                m: fmtMultiple(m.key, m.own.median, lang),
                min: fmtMultiple(m.key, m.own.min, lang),
                max: fmtMultiple(m.key, m.own.max, lang),
              })}
            />
          )}
          {m.peers && (
            <Comparison
              label={t.valuation.vsPeers}
              percentile={m.peers.percentile}
              text={fill(t.valuation.peersText, {
                year: m.peers.year,
                v: fmtMultiple(m.key, m.peers.value, lang),
                m: fmtMultiple(m.key, m.peers.median, lang),
                n: m.peers.n,
                sic: `${m.peers.sicPrefix}${"x".repeat(4 - m.peers.sicPrefix.length)}`,
                p: m.peers.percentile,
              })}
            />
          )}
        </dl>
      )}
      <MonthlyTable k={m.key} rows={v.monthly} lang={lang} />
      <Explain>{t.valuation.what[m.key]}</Explain>
    </article>
  );
}

/** Year-end values of the monthly history (accessible table instead of a chart). */
function MonthlyTable({ k, rows, lang }: { k: MultipleKey; rows: ValuationPayload["monthly"]; lang: Lang }) {
  const { t } = useI18n();
  const yearEnds = useMemo(() => {
    const byYear = new Map<string, { date: string; value: number | null }>();
    for (const r of rows) byYear.set(r.date.slice(0, 4), { date: r.date, value: r[k] });
    return [...byYear.values()].filter((r) => r.value !== null);
  }, [rows, k]);
  if (yearEnds.length < 2) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer select-none text-info min-h-6 inline-flex items-center">{t.ratios.seeHistory}</summary>
      <table className="num mt-1 w-full">
        <caption className="sr-only">{t.valuation.names[k]}</caption>
        <thead>
          <tr className="text-muted">
            <th scope="col" className="text-left font-normal">{t.ratios.year}</th>
            <th scope="col" className="text-right font-normal">{t.valuation.names[k]}</th>
          </tr>
        </thead>
        <tbody>
          {yearEnds.map((r) => (
            <tr key={r.date}>
              <td>{fmtDate(r.date, lang)}</td>
              <td className="text-right">{fmtMultiple(k, r.value, lang)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
