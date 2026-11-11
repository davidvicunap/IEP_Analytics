"use client";

import { fill, useI18n } from "@/lib/i18n";
import { fmtBig, fmtDate, fmtNum, fmtPrice } from "@/lib/format";
import { filingDocUrl, filingIndexUrl } from "@/lib/filingsShared";
import { IS_MARGIN, earningsRelease, type QuarterMetric, type QuarterRow } from "@/lib/quarterReview";
import { useResource } from "@/lib/useResource";
import type { QuarterPayload } from "@/app/api/sec/quarter/[symbol]/route";
import { useFilings } from "./filingsHooks";
import { ExternalIcon } from "./icons";
import { IssueNote, Panel, Skeleton } from "./ui";

type Lang = "es" | "en";

function fmtValue(k: QuarterMetric, v: number | null, lang: Lang) {
  if (v === null) return "—";
  if (IS_MARGIN.has(k)) return `${fmtNum(v * 100, lang, 1)}%`;
  if (k === "eps") return fmtPrice(v, lang);
  return `${v < 0 ? "−" : ""}$${fmtBig(Math.abs(v))}`;
}

function Delta({ k, v, lang }: { k: QuarterMetric; v: number | null; lang: Lang }) {
  const { t } = useI18n();
  if (v === null) return <span className="text-muted">—</span>;
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  const n = fmtNum(Math.abs(v) * 100, lang, 1);
  return <span className={v > 0 ? "text-up" : v < 0 ? "text-down" : ""}>{IS_MARGIN.has(k) ? fill(t.quarter.pts, { v: `${sign}${n}` }) : `${sign}${n}%`}</span>;
}

/** Overview card: the latest quarter against the same quarter a year ago and the one before. */
export default function QuarterCard({ symbol }: { symbol: string }) {
  const { t, lang } = useI18n();
  const Q = t.quarter;
  const { state, retry } = useResource<QuarterPayload>(`/api/sec/quarter/${encodeURIComponent(symbol)}`, { shared: true });
  const { state: filings } = useFilings(symbol);
  if (state.status === "loading") return <Skeleton className="h-64 w-full rounded-xl" />;
  if (state.status === "error") {
    // No SEC filings (an ETF, a foreign filer): nothing to review, so no card.
    if (state.issue === "not_found") return null;
    return (
      <Panel title={Q.title}>
        <IssueNote issue={state.issue} onRetry={retry} />
      </Panel>
    );
  }
  const { review: r, cik } = state.data;
  if (!r) return null;
  const release = filings.status === "ok" ? earningsRelease(filings.data.filings, r.end) : null;
  const revenue = r.rows.find((x) => x.key === "revenue");
  const cols: { label: string; pick: (x: QuarterRow) => number | null }[] = [];
  if (r.yearAgoLabel) cols.push({ label: fill(Q.cols.vs, { q: r.yearAgoLabel }), pick: (x) => x.vsYearAgo });
  if (r.priorLabel) cols.push({ label: fill(Q.cols.vs, { q: r.priorLabel }), pick: (x) => x.vsPrior });

  return (
    <Panel title={Q.title} description={fill(Q.period, { q: r.label, d: fmtDate(r.end, lang) })} id="quarter">
      {revenue?.vsYearAgo != null && (
        <p className="mb-3 text-sm">
          {fill(Q.headline, { v: `${revenue.vsYearAgo > 0 ? "+" : revenue.vsYearAgo < 0 ? "−" : ""}${fmtNum(Math.abs(revenue.vsYearAgo) * 100, lang, 1)}%` })}
        </p>
      )}
      <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label={Q.title}>
        <table className="num w-full text-sm">
          <thead>
            <tr className="text-xs text-muted border-b border-line">
              <th scope="col" className="py-1.5 pr-3 text-left font-normal">{Q.cols.metric}</th>
              <th scope="col" className="py-1.5 px-2 text-right font-normal">{Q.cols.now}</th>
              {cols.map((c) => (
                <th key={c.label} scope="col" className="py-1.5 pl-2 text-right font-normal whitespace-nowrap">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.rows.map((x) => (
              <tr key={x.key} className="border-b border-line last:border-0">
                <th scope="row" className="py-2 pr-3 text-left font-sans font-normal">{Q.metrics[x.key]}</th>
                <td className="py-2 px-2 text-right font-medium">{fmtValue(x.key, x.now, lang)}</td>
                {cols.map((c) => (
                  <td key={c.label} className="py-2 pl-2 text-right">
                    <Delta k={x.key} v={c.pick(x)} lang={lang} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        {r.filing && (
          <a href={filingIndexUrl(cik, r.filing.accn)} target="_blank" rel="noopener noreferrer" className="link inline-flex min-h-8 items-center gap-1">
            {fill(Q.report, { f: r.filing.form ?? "SEC" })}
            <ExternalIcon size={13} />
          </a>
        )}
        {release && (
          <a href={filingDocUrl(cik, release)} target="_blank" rel="noopener noreferrer" className="link inline-flex min-h-8 items-center gap-1">
            {Q.release} ({fmtDate(release.filed, lang)})
            <ExternalIcon size={13} />
          </a>
        )}
      </div>
      <p className="mt-2 text-xs text-muted leading-relaxed">{Q.note}</p>
    </Panel>
  );
}
