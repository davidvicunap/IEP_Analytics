"use client";

import { useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { fmtDate } from "@/lib/format";
import { filingDocUrl, formGroup, type Filing } from "@/lib/filingsShared";
import type { DataIssue } from "@/lib/types";
import { useFilings, useFormLabel } from "./filingsHooks";
import { IssueNote } from "./ui";

/** Latest official releases (8-K) — shared by the News tab and the overview. */
export function OfficialReleases({ symbol, limit, onSeeAll }: { symbol: string; limit: number; onSeeAll?: () => void }) {
  const { t, lang } = useI18n();
  const state = useFilings(symbol);
  const label = useFormLabel();
  const releases: Filing[] = useMemo(
    () => (state?.ok ? state.data.filings.filter((f) => formGroup(f.form) === "current").slice(0, limit) : []),
    [state, limit],
  );
  if (state === null) return <div className="h-24 rounded-lg bg-panel-2 animate-pulse" aria-hidden="true" />;
  if (!state.ok) return <IssueNote issue={state.error as DataIssue} />;
  if (releases.length === 0) return <p className="text-sm text-muted">{t.news.none}</p>;
  return (
    <div>
      <ul className="divide-y divide-line">
        {releases.map((f) => (
          <li key={f.accn} className="py-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <time dateTime={f.filed} className="num text-xs text-muted w-24 shrink-0">{fmtDate(f.filed, lang)}</time>
            <span className="text-sm flex-1 min-w-0">
              {f.items.length ? f.items.map((i) => t.filings.items[i] ?? i).filter((x) => x !== t.filings.items["9.01"]).join(" · ") || label(f) : label(f)}
              <span className="text-muted text-xs"> · {f.form}</span>
            </span>
            <a href={filingDocUrl(state.data.cik, f)} target="_blank" rel="noopener noreferrer" className="link text-xs">
              {t.news.open}
            </a>
          </li>
        ))}
      </ul>
      {onSeeAll && (
        <button type="button" onClick={onSeeAll} className="mt-2 min-h-8 text-xs link">
          {t.news.all}
        </button>
      )}
    </div>
  );
}

