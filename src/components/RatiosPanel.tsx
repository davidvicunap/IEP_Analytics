"use client";

import { useContext } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtNum } from "@/lib/format";
import type { RatioGroup, RatioKey } from "@/lib/ratios";
import type { RatioRow, RatiosPayload } from "@/lib/ratiosData";
import type { Level } from "@/lib/scoring";
import { useResource } from "@/lib/useResource";
import { InWindow, IssueNote, LevelBadge, Panel } from "./ui";

const GROUPS: RatioGroup[] = ["profitability", "returns", "health", "growth"];
type Lang = "es" | "en";

function fmtRatio(key: RatioKey, v: number | null | undefined, lang: Lang): string {
  if (v === null || v === undefined) return "—";
  if (key === "debtToEquity") return `${fmtNum(v, lang, 2)}x`;
  return `${fmtNum(v * 100, lang, 1)}%`;
}

/** Traffic light from where the value sits, turned around for "lower is better" ratios. */
export function ratioLevel(r: Pick<RatioRow, "better" | "sector" | "own">): Level | null {
  const p = r.sector?.percentile ?? r.own?.percentile;
  if (p === undefined) return null;
  const q = r.better === "higher" ? p : 100 - p;
  return q >= 67 ? "good" : q <= 33 ? "bad" : "ok";
}

export default function RatiosPanel({ symbol }: { symbol: string }) {
  const { t, lang } = useI18n();
  const { state, retry } = useResource<RatiosPayload>(`/api/sec/ratios/${encodeURIComponent(symbol)}`);

  if (state.status === "loading") {
    return (
      <Panel title={t.ratios.title}>
        <p role="status" className="text-sm text-muted">{t.ratios.loading}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-36 rounded-lg bg-panel-2 animate-pulse" />)}
        </div>
      </Panel>
    );
  }
  if (state.status === "error") {
    return (
      <Panel title={t.ratios.title}>
        <IssueNote issue={state.issue} onRetry={retry} />
      </Panel>
    );
  }

  const d = state.data;
  const notApplicable = d.ratios.filter((r) => !r.applicable).map((r) => t.ratios.names[r.key]);
  const typeLabel = t.ratios.types[d.businessType];

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="section-title">{t.ratios.title}</h2>
        <p className="text-sm">
          {d.sicDescription ? (
            <>
              {t.ratios.industry}: <span className="font-medium">{d.sicDescription}</span>
              <span className="text-muted"> · SIC {d.sic}</span>
            </>
          ) : (
            <span className="text-muted">{t.ratios.noSic}</span>
          )}
          {typeLabel && <span className="ml-2 rounded-md bg-panel-2 text-muted px-1.5 py-0.5 text-[11px] font-medium">{typeLabel}</span>}
        </p>
        {d.period && <p className="text-xs text-muted">{d.period.label}</p>}
      </div>

      <RatiosTable payload={d} lang={lang} />

      <details className="text-sm">
        <summary className="link inline-flex min-h-11 cursor-pointer items-center sm:min-h-0">{t.ratios.whatTitle}</summary>
        <dl className="mt-2 max-w-[68ch] space-y-2">
          {d.ratios
            .filter((r) => r.applicable)
            .map((r) => (
              <div key={r.key}>
                <dt className="font-medium">{t.ratios.names[r.key]}</dt>
                <dd className="text-muted">
                  {t.ratios.what[r.key]} <span className="text-[12px]">= {t.ratios.formulas[r.key]}</span>
                </dd>
              </div>
            ))}
        </dl>
      </details>

      <div className="space-y-1 text-[11px] text-muted">
        {notApplicable.length > 0 && <p>{fill(t.ratios.notApplicable, { list: notApplicable.join(", ") })}</p>}
        {d.peersYear && <p>{fill(t.ratios.method, { year: d.peersYear })}</p>}
        <p>
          {t.ratios.source} · {t.data.updated} <time dateTime={state.fetchedAt}>{fmtAsOf(state.fetchedAt, lang)}</time>
        </p>
      </div>
    </div>
  );
}

/**
 * Every ratio in one table: the company's figure, the industry's median and where the company
 * stands among those companies, and the same against its own last 10 years. Grouped by section;
 * each figure's yearly values open in place.
 */
function RatiosTable({ payload: d, lang }: { payload: RatiosPayload; lang: Lang }) {
  const { t } = useI18n();
  const R = t.ratios;
  const C = R.cols;
  const cell = "border-t border-line px-3 py-2.5 align-top";
  // The pinned column takes the surface it sits on: the page, or a canvas window.
  const inWindow = useContext(InWindow);
  const sticky = `sticky left-0 z-10 ${inWindow ? "bg-panel" : "bg-bg"}`;
  return (
    <div className="relative -mx-4 overflow-x-auto sm:mx-0" tabIndex={0} role="region" aria-label={R.title}>
      <table className="num w-max min-w-full border-separate border-spacing-0 text-[13px]">
        <caption className="sr-only">{R.title}</caption>
        <thead>
          <tr className="text-xs text-muted">
            <th scope="col" className={`${sticky} pb-2 pl-4 pr-3 text-left font-normal sm:pl-0`}>{C.metric}</th>
            <th scope="col" className="px-3 pb-2 text-right font-normal">{C.value}</th>
            <th scope="col" className="px-3 pb-2 text-right font-normal">{C.industry}</th>
            <th scope="col" className="px-3 pb-2 text-left font-normal">{C.standing}</th>
            <th scope="col" className="pb-2 pl-3 pr-4 text-left font-normal sm:pr-0">{C.history}</th>
          </tr>
        </thead>
        {GROUPS.map((g) => {
          const rows = d.ratios.filter((r) => r.group === g && r.applicable);
          if (rows.length === 0) return null;
          return (
            <tbody key={g}>
              <tr>
                <th scope="colgroup" colSpan={5} className={`${sticky} border-t border-line-strong pb-1.5 pl-4 pt-4 text-left text-[13px] font-semibold sm:pl-0`}>
                  {R.groups[g]}
                </th>
              </tr>
              {rows.map((r) => {
                // No standing on a figure the SEC data itself disagrees about.
                const ambiguous = r.note === "revenueAmbiguous";
                const level = r.value === null || ambiguous ? null : ratioLevel(r);
                return (
                  <tr key={r.key} data-ratio={r.key}>
                    <th scope="row" className={`${sticky} ${cell} pl-4 text-left font-sans font-normal sm:pl-0`}>
                      {/* Narrow on phones so the company's figure shows beside it; the rest scrolls. */}
                      <div className="max-w-[9.5rem] sm:max-w-none">
                        <span className="font-medium">{R.names[r.key]}</span>
                        {r.note && <span className="block max-w-[28ch] text-xs text-warn">{R.notes[r.note]}</span>}
                        <History r={r} lang={lang} />
                      </div>
                    </th>
                    <td className={`${cell} text-right font-semibold ${r.value !== null && r.value < 0 ? "text-down" : ""}`}>
                      {r.value === null ? <span className="font-normal text-muted" title={R.noValue}>—</span> : fmtRatio(r.key, r.value, lang)}
                    </td>
                    <td className={`${cell} text-right`}>{r.sector && !ambiguous ? fmtRatio(r.key, r.sector.median, lang) : "—"}</td>
                    <td className={cell}>
                      {r.value !== null && r.sector && !ambiguous ? (
                        <>
                          <span className="flex items-center gap-2 whitespace-nowrap">
                            {fill(R.higherThan, { p: r.sector.percentile })}
                            {level && <LevelBadge level={level} />}
                          </span>
                          <span className="block text-xs text-muted">
                            {fill(R.ofCompanies, { n: r.sector.n, sic: `${r.sector.sicPrefix}${"x".repeat(4 - r.sector.sicPrefix.length)}` })}
                          </span>
                        </>
                      ) : (
                        <span className="block max-w-[26ch] text-xs text-muted">{r.value === null ? R.noValue : d.sic ? R.noSector : R.noSic}</span>
                      )}
                    </td>
                    <td className={`${cell} pr-4 sm:pr-0`}>
                      {r.value !== null && r.own ? (
                        <>
                          <span className="block whitespace-nowrap">{fill(R.ownMedian, { m: fmtRatio(r.key, r.own.median, lang) })}</span>
                          <span className="block text-xs text-muted">{fill(R.ownHigher, { p: r.own.percentile })}</span>
                        </>
                      ) : (
                        <span className="block max-w-[24ch] text-xs text-muted">{r.value === null ? "—" : R.shortHistory}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

function History({ r, lang }: { r: RatioRow; lang: Lang }) {
  const { t } = useI18n();
  const points = r.history.filter((h) => h.value !== null);
  if (points.length < 2) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer select-none link inline-flex min-h-11 items-center font-normal sm:min-h-6">{t.ratios.seeHistory}</summary>
      <table className="num mt-1 w-full">
        <caption className="sr-only">{t.ratios.names[r.key]}</caption>
        <thead>
          <tr className="text-muted">
            <th scope="col" className="text-left font-normal">{t.ratios.year}</th>
            <th scope="col" className="text-right font-normal">{t.ratios.names[r.key]}</th>
          </tr>
        </thead>
        <tbody>
          {r.history.map((h) => (
            <tr key={h.label}>
              <td>{h.label}</td>
              <td className={`text-right ${h.value !== null && h.value < 0 ? "text-down" : ""}`}>{fmtRatio(r.key, h.value, lang)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
