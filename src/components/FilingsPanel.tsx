"use client";

import { useMemo, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtDate } from "@/lib/format";
import { filingDocUrl, filingIndexUrl, formGroup, xbrlViewerUrl, type Filing, type FormGroup } from "@/lib/filingsShared";
import type { DataIssue } from "@/lib/types";
import { IssueNote, Panel } from "./ui";

const PAGE = 100;
const GROUPS: ("all" | FormGroup)[] = ["all", "annual", "quarterly", "current", "proxy", "insiders", "ownership", "registration", "other"];

export { useFilings, useFormLabel } from "./filingsHooks";
import { useFilings, useFormLabel } from "./filingsHooks";

export default function FilingsPanel({ symbol }: { symbol: string }) {
  const { t, lang } = useI18n();
  const [older, setOlder] = useState(false);
  const state = useFilings(symbol, older);
  const [group, setGroup] = useState<"all" | FormGroup>("all");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const label = useFormLabel();

  const filtered = useMemo(() => {
    if (!state?.ok) return [];
    const q = query.trim().toLowerCase();
    return state.data.filings.filter((f) => {
      if (group !== "all" && formGroup(f.form) !== group) return false;
      if (!q) return true;
      const text = `${f.form} ${label(f)} ${f.items.map((i) => t.filings.items[i] ?? i).join(" ")}`.toLowerCase();
      return text.includes(q);
    });
  }, [state, group, query, label, t]);

  if (state === null) {
    return (
      <Panel title={t.filings.title}>
        <p role="status" className="text-sm text-muted">{t.filings.loading}</p>
        <div className="mt-3 h-64 rounded-lg bg-panel-2 animate-pulse" aria-hidden="true" />
      </Panel>
    );
  }
  if (!state.ok) {
    return (
      <Panel title={t.filings.title}>
        <IssueNote issue={state.error as DataIssue} />
      </Panel>
    );
  }
  const { cik, older: olderInfo } = state.data;
  const visible = filtered.slice(0, shown);
  const chip = (on: boolean) =>
    `h-8 px-3 rounded-full text-[13px] font-medium border ${on ? "bg-panel-2 text-fg border-line-strong" : "border-transparent text-muted hover:text-fg hover:bg-panel-2"}`;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="section-title">{t.filings.title}</h2>
        <p className="text-sm">{t.filings.intro}</p>
      </div>

      <Panel>
        <div role="group" aria-label={t.filings.filterLabel} className="flex flex-wrap gap-2">
          {GROUPS.map((g) => (
            <button key={g} type="button" aria-pressed={group === g} className={chip(group === g)} onClick={() => { setGroup(g); setShown(PAGE); }}>
              {t.filings.groups[g]}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="filings-search" className="text-[11px] text-muted">{t.filings.search}</label>
            <input
              id="filings-search"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }}
              placeholder={t.filings.searchPlaceholder}
              className="h-9 w-64 max-w-full rounded-md border border-line bg-panel px-2 text-sm"
            />
          </div>
          <p className="text-xs text-muted" role="status">{fill(t.filings.count, { n: filtered.length })}</p>
        </div>
      </Panel>

      <Panel>
        {visible.length === 0 ? (
          <p className="text-sm text-muted">{t.filings.none}</p>
        ) : (
          <div className="relative overflow-x-auto -mx-4" tabIndex={0} aria-label={t.filings.title}>
            <table className="text-sm w-full min-w-[44rem]">
              <caption className="sr-only">{t.filings.title}</caption>
              <thead>
                <tr className="text-xs text-muted">
                  <th scope="col" className="text-left font-normal pl-4 py-1">{t.filings.cols.date}</th>
                  <th scope="col" className="text-left font-normal">{t.filings.cols.form}</th>
                  <th scope="col" className="text-left font-normal">{t.filings.cols.what}</th>
                  <th scope="col" className="text-left font-normal">{t.filings.cols.period}</th>
                  <th scope="col" className="text-right font-normal pr-4">{t.filings.cols.links}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((f) => (
                  <tr key={f.accn} className="border-t border-line align-top">
                    <td className="num pl-4 py-2 whitespace-nowrap">{fmtDate(f.filed, lang)}</td>
                    <td className="py-2">
                      <span className="inline-block rounded bg-panel-2 px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap">{f.form}</span>
                    </td>
                    <td className="py-2 pr-3">
                      {label(f)}
                      {f.items.length > 0 && (
                        <span className="block text-[11px] text-muted">{f.items.map((i) => t.filings.items[i] ?? i).join(" · ")}</span>
                      )}
                    </td>
                    <td className="num py-2 whitespace-nowrap text-muted">{f.reportDate ? fmtDate(f.reportDate, lang) : "—"}</td>
                    <td className="py-2 pr-4 text-right whitespace-nowrap">
                      <a className="link" href={filingDocUrl(cik, f)} target="_blank" rel="noopener noreferrer">{t.filings.doc}</a>
                      <span className="text-muted"> · </span>
                      <a className="link" href={filingIndexUrl(cik, f.accn)} target="_blank" rel="noopener noreferrer">{t.filings.index}</a>
                      {f.inlineXbrl && (
                        <>
                          <span className="text-muted"> · </span>
                          <a className="link" href={xbrlViewerUrl(cik, f)} target="_blank" rel="noopener noreferrer" title={t.filings.xbrlTitle}>
                            {t.filings.xbrl}
                          </a>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {filtered.length > shown && (
            <button type="button" onClick={() => setShown((n) => n + PAGE)} className="h-11 sm:h-9 px-3.5 rounded-lg text-[13px] font-medium border border-line bg-panel hover:bg-panel-2">
              {fill(t.filings.more, { n: filtered.length - shown })}
            </button>
          )}
          {olderInfo.available && !olderInfo.loaded && (
            <button type="button" onClick={() => setOlder(true)} className="h-11 sm:h-9 px-3.5 rounded-lg text-[13px] font-medium border border-line bg-panel hover:bg-panel-2">
              {fill(t.filings.older, { date: olderInfo.from ? fmtDate(olderInfo.from, lang) : "—" })}
            </button>
          )}
        </div>
      </Panel>
      <p className="text-[11px] text-muted">{t.filings.source}</p>
    </div>
  );
}
