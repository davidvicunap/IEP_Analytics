"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtBig, fmtDate, fmtNum, fmtPrice } from "@/lib/format";
import { seriesStats, type HistoryAnalysis, type MultipleKey } from "@/lib/valuation";
import type { MultipleRow, ValuationPayload } from "@/lib/valuationData";
import type { DataIssue } from "@/lib/types";
import { Explain, IssueNote, Panel } from "../ui";

const MultipleChart = dynamic(() => import("./MultipleChart"), {
  ssr: false,
  loading: () => <div className="h-[300px] rounded-lg bg-panel-2 animate-pulse" />,
});

type Lang = "es" | "en";
type Verdict = HistoryAnalysis["verdict"];

const money = (v: number) => (v < 0 ? `−$${fmtBig(-v)}` : `$${fmtBig(v)}`);
const signed = (v: number, lang: Lang, digits = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtNum(Math.abs(v), lang, digits)}`;

export function fmtMultiple(key: MultipleKey, v: number | null | undefined, lang: Lang): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return key === "fcfYield" ? `${fmtNum(v * 100, lang, 1)}%` : `${fmtNum(v, lang, 1)}x`;
}

const VERDICT_STYLE: Record<Verdict, string> = {
  cheap: "bg-up-bg text-up",
  expensive: "bg-down-bg text-down",
  inRange: "bg-info-bg text-info",
};

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const { t } = useI18n();
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${VERDICT_STYLE[verdict]}`}>
      {t.valuation.history.verdictShort[verdict]}
    </span>
  );
}

/** The company's multiples against their own last 5 years: chart, reading and summary. */
export default function HistoryView({ v }: { v: ValuationPayload }) {
  const { t, lang } = useI18n();
  const h = t.valuation.history;
  const rows = useMemo(() => v.multiples.filter((m) => m.applicable), [v]);
  const skipped = v.multiples.filter((m) => !m.applicable);
  const hasMonths = (k: MultipleKey) => v.monthly.some((r) => r[k] !== null);
  const [picked, setPicked] = useState<MultipleKey | null>(null);
  const key = picked ?? rows.find((m) => m.own)?.key ?? rows.find((m) => hasMonths(m.key))?.key ?? rows[0]?.key ?? null;
  const row = rows.find((m) => m.key === key) ?? null;

  const historyIssue =
    v.history.issue && v.history.issue in t.valuation.historyIssues
      ? t.valuation.historyIssues[v.history.issue as keyof typeof t.valuation.historyIssues]
      : null;

  const select = (k: MultipleKey, scroll = false) => {
    setPicked(k);
    if (scroll) document.getElementById("multiple-history")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-4">
      <Panel>
        <h3 className="text-sm font-semibold">{h.title}</h3>
        <p className="mt-1 max-w-3xl text-xs text-muted leading-relaxed">{h.intro}</p>
        {v.ttm ? (
          <p className="mt-2 text-xs text-muted">
            {fill(h.basis, { price: fmtPrice(v.price, lang), cap: money(v.marketCap), ttm: v.ttm.label })}
          </p>
        ) : (
          <p className="mt-2 text-xs text-warn">{t.valuation.noTtm}</p>
        )}
        {historyIssue && <p className="mt-2 text-xs text-warn">{historyIssue}</p>}
        {v.history.issue && !historyIssue && <IssueNote issue={v.history.issue as DataIssue} className="mt-2" />}

        {rows.length > 0 && (
          <div role="group" aria-label={h.selectLabel} className="mt-3 flex flex-wrap gap-1">
            {rows.map((m) => (
              <button
                key={m.key}
                type="button"
                aria-pressed={m.key === key}
                onClick={() => select(m.key)}
                className={`h-9 px-3 rounded-md text-[13px] font-medium border ${
                  m.key === key ? "bg-panel-2 text-fg border-line-strong" : "border-transparent text-muted hover:text-fg hover:bg-panel-2"
                }`}
              >
                {h.short[m.key]}
              </button>
            ))}
          </div>
        )}

        {row && <MultipleDetail key={row.key} row={row} v={v} lang={lang} />}
      </Panel>

      {rows.length > 0 && <SummaryTable rows={rows} v={v} lang={lang} selected={key} onSelect={(k) => select(k, true)} />}

      <div className="space-y-1 text-[11px] text-muted">
        {skipped.length > 0 && <p>{fill(t.valuation.notApplicable, { list: skipped.map((m) => h.short[m.key]).join(", ") })}</p>}
        <p>{h.method}</p>
      </div>
    </div>
  );
}

function MultipleDetail({ row, v, lang }: { row: MultipleRow; v: ValuationPayload; lang: Lang }) {
  const { t } = useI18n();
  const h = t.valuation.history;
  const key = row.key;
  const a = row.own;

  // Month-ends, then today's value (live quote ÷ latest public TTM) so the line ends where we are.
  const points = useMemo(() => {
    const pts = v.monthly.filter((r) => r[key] !== null).map((r) => ({ date: r.date, value: r[key] as number }));
    const today = v.quoteAt.slice(0, 10);
    if (row.value !== null && pts.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(today)) {
      const last = pts[pts.length - 1];
      if (last.date === today) last.value = row.value;
      else if (last.date < today) pts.push({ date: today, value: row.value });
    }
    return pts;
  }, [v, key, row.value]);

  // Without today's value (e.g. a loss) there's no analysis, but the history still tells a story.
  const stats = useMemo(() => a ?? seriesStats(v.monthly.map((r) => r[key]).filter((x): x is number => x !== null)), [a, v, key]);
  const labels = useMemo(() => ({ median: h.median, plus: h.plus, minus: h.minus }), [h]);
  const format = useCallback((x: number) => fmtMultiple(key, x, lang), [key, lang]);
  const showChart = points.length >= 2 && stats !== null;
  const from = points[0]?.date;

  return (
    <section id="multiple-history" aria-labelledby="multiple-history-title" className="mt-4 scroll-mt-20">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h4 id="multiple-history-title" className="text-base font-semibold">{t.valuation.names[key]}</h4>
        <span className={`num text-2xl font-semibold ${row.value !== null && row.value < 0 ? "text-down" : ""}`}>
          {fmtMultiple(key, row.value, lang)}
        </span>
        {a && <VerdictBadge verdict={a.verdict} />}
      </div>
      <p className="text-[11px] text-muted">= {t.valuation.formulas[key]}</p>
      {row.note && <p className="mt-1 text-xs text-warn">{t.valuation.notes[row.note]}</p>}

      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="min-w-0">
          {showChart ? (
            <>
              <MultipleChart
                points={points}
                median={stats.median}
                mean={stats.mean}
                sd={stats.sd}
                labels={labels}
                format={format}
                summary={fill(h.chartLabel, {
                  name: t.valuation.names[key],
                  from: fmtDate(from!, lang),
                  now: fmtMultiple(key, row.value, lang),
                  median: fmtMultiple(key, stats.median, lang),
                  mean: fmtMultiple(key, stats.mean, lang),
                  sd: fmtMultiple(key, stats.sd, lang),
                })}
              />
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted" aria-hidden="true">
                <li className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-4 rounded bg-series-1" />
                  {h.short[key]}
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-4 rounded bg-info" />
                  {h.median}
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <span className="w-4 border-t border-dashed border-warn" />
                  {h.plus} / {h.minus}
                </li>
              </ul>
              <MonthlyData k={key} points={points} lang={lang} />
            </>
          ) : (
            <p className="rounded-lg bg-panel-2 p-4 text-sm text-muted">{h.noHistory}</p>
          )}
        </div>

        <div className="min-w-0 space-y-3 text-sm leading-relaxed">
          {a ? (
            <Reading a={a} row={row} v={v} lang={lang} />
          ) : (
            stats &&
            showChart && (
              <p className="text-muted">
                {fill(h.stats, {
                  median: fmtMultiple(key, stats.median, lang),
                  mean: fmtMultiple(key, stats.mean, lang),
                  sd: fmtMultiple(key, stats.sd, lang),
                  min: fmtMultiple(key, stats.min, lang),
                  max: fmtMultiple(key, stats.max, lang),
                  n: stats.n,
                  from: fmtDate(from!, lang),
                })}
              </p>
            )
          )}
          <p className="rounded-lg border border-line bg-panel-2 p-3 text-xs text-muted">{h.caution}</p>
          <Explain>{t.valuation.what[key]}</Explain>
        </div>
      </div>
    </section>
  );
}

function Reading({ a, row, v, lang }: { a: HistoryAnalysis; row: MultipleRow; v: ValuationPayload; lang: Lang }) {
  const { t } = useI18n();
  const h = t.valuation.history;
  const key = row.key;
  const m = (x: number) => fmtMultiple(key, x, lang);
  const verdictText = (row.higherIsCheaper ? h.verdictYield : h.verdict)[a.verdict];
  const diff = a.priceAtMedian !== null ? a.priceAtMedian / v.price - 1 : null;
  return (
    <>
      <p className="font-medium">{verdictText}</p>
      <p>{fill(h.position, { p: a.percentile, from: fmtDate(a.from, lang), z: signed(a.z, lang) })}</p>
      {a.priceAtMedian !== null && diff !== null ? (
        <p>
          {fill(h.atMedian, {
            median: m(a.median),
            p: fmtPrice(a.priceAtMedian, lang),
            d: `${signed(diff * 100, lang)}%`,
          })}
          {key === "evEbitda" && <span className="block mt-1 text-xs text-muted">{h.evNote}</span>}
        </p>
      ) : (
        <p className="text-muted">{h.noPriceAtMedian}</p>
      )}
      <p className="text-xs text-muted">
        {fill(h.stats, {
          median: m(a.median),
          mean: m(a.mean),
          sd: m(a.sd),
          min: m(a.min),
          max: m(a.max),
          n: a.n,
          from: fmtDate(a.from, lang),
        })}
      </p>
    </>
  );
}

/** The numbers behind the chart, for screen readers and for checking. */
function MonthlyData({ k, points, lang }: { k: MultipleKey; points: { date: string; value: number }[]; lang: Lang }) {
  const { t } = useI18n();
  const h = t.valuation.history;
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer select-none link min-h-8 inline-flex items-center">{h.dataTable}</summary>
      <div className="relative mt-1 max-h-64 overflow-y-auto rounded-lg border border-line" tabIndex={0} role="region" aria-label={h.dataTable}>
        <table className="num w-full">
          <caption className="sr-only">{t.valuation.names[k]}</caption>
          <thead className="sticky top-0 bg-panel">
            <tr className="text-muted">
              <th scope="col" className="px-3 py-1.5 text-left font-normal">{h.date}</th>
              <th scope="col" className="px-3 py-1.5 text-right font-normal">{h.short[k]}</th>
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((p) => (
              <tr key={p.date} className="border-t border-line">
                <td className="px-3 py-1">{fmtDate(p.date, lang)}</td>
                <td className="px-3 py-1 text-right">{fmtMultiple(k, p.value, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function SummaryTable({
  rows,
  v,
  lang,
  selected,
  onSelect,
}: {
  rows: MultipleRow[];
  v: ValuationPayload;
  lang: Lang;
  selected: MultipleKey | null;
  onSelect: (k: MultipleKey) => void;
}) {
  const { t } = useI18n();
  const h = t.valuation.history;
  const c = h.cols;
  // Overall: the spread of prices the multiples would give back at their own medians.
  const implied = rows.map((m) => m.own?.priceAtMedian).filter((x): x is number => x != null);
  const overall = implied.length >= 2 ? seriesStats(implied) : null;
  const dear = implied.filter((p) => p < v.price).length;
  return (
    <Panel title={h.tableTitle}>
      {overall && (
        <p className="mb-3 text-sm leading-relaxed">
          {fill(h.overall, {
            min: fmtPrice(overall.min, lang),
            max: fmtPrice(overall.max, lang),
            mid: fmtPrice(overall.median, lang),
            d: `${signed((overall.median / v.price - 1) * 100, lang)}%`,
            dear,
            n: implied.length,
          })}
        </p>
      )}
      <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label={h.tableTitle}>
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th scope="col" className="py-2 pr-3 text-left font-normal">{c.multiple}</th>
              <th scope="col" className="py-2 px-3 text-right font-normal">{c.now}</th>
              <th scope="col" className="py-2 px-3 text-right font-normal">{c.median}</th>
              <th scope="col" className="py-2 px-3 text-right font-normal">{c.pctl}</th>
              <th scope="col" className="py-2 px-3 text-right font-normal">{c.z}</th>
              <th scope="col" className="py-2 px-3 text-right font-normal">{c.atMedian}</th>
              <th scope="col" className="py-2 pl-3 text-left font-normal">{c.verdict}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const a = m.own;
              const diff = a?.priceAtMedian != null ? a.priceAtMedian / v.price - 1 : null;
              return (
                <tr key={m.key} className={`border-t border-line ${m.key === selected ? "bg-panel-2" : ""}`}>
                  <th scope="row" className="py-2 pr-3 text-left font-medium">
                    <button
                      type="button"
                      onClick={() => onSelect(m.key)}
                      aria-current={m.key === selected ? "true" : undefined}
                      className="min-h-8 link"
                    >
                      {h.short[m.key]}
                    </button>
                  </th>
                  <td className="num py-2 px-3 text-right">{fmtMultiple(m.key, m.value, lang)}</td>
                  <td className="num py-2 px-3 text-right">{a ? fmtMultiple(m.key, a.median, lang) : "—"}</td>
                  <td className="num py-2 px-3 text-right">{a ? a.percentile : "—"}</td>
                  <td className="num py-2 px-3 text-right">{a ? signed(a.z, lang) : "—"}</td>
                  <td className="num py-2 px-3 text-right">
                    {a?.priceAtMedian != null && diff !== null ? (
                      <>
                        {fmtPrice(a.priceAtMedian, lang)} <span className="text-xs text-muted">({signed(diff * 100, lang, 0)}%)</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 pl-3">
                    {a ? <VerdictBadge verdict={a.verdict} /> : <span className="text-xs text-muted">{m.note ? t.valuation.notes[m.note] : "—"}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
