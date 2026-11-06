"use client";

import { useI18n } from "@/lib/i18n";
import { fmtBig, fmtDate, fmtNum, fmtPct } from "@/lib/format";
import type { MetricScore } from "@/lib/scoring";
import type { AnnualIncome, DataSource, Result } from "@/lib/types";
import { Explain, IssueNote, LevelBadge, Panel, Provenance } from "./ui";

export function MetricGrid({ scores }: { scores: MetricScore[] }) {
  const { t, lang } = useI18n();
  if (scores.length === 0) return <p className="text-sm text-muted">{t.stock.noData}</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {scores.map((s) => {
        const m = t.metrics[s.key];
        const value = s.format === "pct" ? fmtPct(s.value, lang, { fraction: true }) : `${fmtNum(s.value, lang)}x`;
        return (
          <article key={s.key} className="rounded-lg border border-line bg-panel p-3">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-medium">{m.name}</h3>
              <LevelBadge level={s.level} />
            </div>
            <p className="num text-2xl font-semibold mt-1">{value}</p>
            <Explain>{m.what}</Explain>
          </article>
        );
      })}
    </div>
  );
}

/** Simple paired bar chart: revenue vs net income per year. */
export function IncomeBars({ income: result, source }: { income: Result<AnnualIncome[]>; source: DataSource }) {
  const { t, lang } = useI18n();
  if (!result.ok) {
    return (
      <Panel title={t.stock.revenueTitle}>
        <IssueNote issue={result.error} />
      </Panel>
    );
  }
  const income = result.data;
  if (income.length === 0) return null;
  const lastFiling = income.at(-1)?.filingDate;
  const max = Math.max(...income.map((i) => Math.max(i.revenue, Math.abs(i.netIncome))), 1);
  return (
    <Panel title={t.stock.revenueTitle}>
      <div className="flex gap-4 text-xs mb-3">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-accent" aria-hidden="true" />{t.stock.revenue}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-info" aria-hidden="true" />{t.stock.netIncome}</span>
      </div>
      <table className="sr-only">
        <thead><tr><th>Year</th><th>{t.stock.revenue}</th><th>{t.stock.netIncome}</th></tr></thead>
        <tbody>
          {income.map((i) => (
            <tr key={i.year}><td>{i.year}</td><td>{fmtBig(i.revenue, lang)}</td><td>{fmtBig(i.netIncome, lang)}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-end gap-2 sm:gap-4 h-44" aria-hidden="true">
        {income.map((i) => (
          <div key={i.year} className="flex-1 min-w-0 flex flex-col items-center gap-1 h-full justify-end">
            <div className="flex items-end gap-0.5 sm:gap-1 w-full justify-center flex-1">
              <div className="w-1/2 max-w-7 bg-accent rounded-t" style={{ height: `${(i.revenue / max) * 100}%` }} title={fmtBig(i.revenue, lang)} />
              <div
                className={`w-1/2 max-w-7 rounded-t ${i.netIncome >= 0 ? "bg-info" : "bg-down"}`}
                style={{ height: `${(Math.abs(i.netIncome) / max) * 100}%` }}
                title={fmtBig(i.netIncome, lang)}
              />
            </div>
            <span className="num text-[10px] text-muted">{i.year}</span>
            <span className="num text-[10px] hidden sm:block">{fmtBig(i.revenue, lang)}</span>
          </div>
        ))}
      </div>
      <Provenance source={source} asOf={result.fetchedAt} className="mt-3" />
      {lastFiling && (
        <p className="text-[11px] text-muted">
          {t.data.lastFiling}: <time dateTime={lastFiling}>{fmtDate(lastFiling, lang)}</time>
        </p>
      )}
    </Panel>
  );
}
