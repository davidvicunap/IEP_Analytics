"use client";

import { useEffect, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtNum } from "@/lib/format";
import type { RatioGroup, RatioKey } from "@/lib/ratios";
import type { RatioRow, RatiosPayload } from "@/lib/ratiosData";
import type { Level } from "@/lib/scoring";
import type { DataIssue, Result } from "@/lib/types";
import { Comparison, Explain, IssueNote, LevelBadge, Panel } from "./ui";

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
  const [state, setState] = useState<Result<RatiosPayload> | null>(null);

  useEffect(() => {
    let alive = true;
    setState(null);
    fetch(`/api/sec/ratios/${encodeURIComponent(symbol)}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as Result<RatiosPayload> | null;
        if (alive) setState(body ?? { ok: false, error: "upstream" });
      })
      .catch(() => alive && setState({ ok: false, error: "upstream" }));
    return () => {
      alive = false;
    };
  }, [symbol]);

  if (state === null) {
    return (
      <Panel title={t.ratios.title}>
        <p role="status" className="text-sm text-muted">{t.ratios.loading}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-36 rounded-lg bg-panel-2 animate-pulse" />)}
        </div>
      </Panel>
    );
  }
  if (!state.ok) {
    return (
      <Panel title={t.ratios.title}>
        <IssueNote issue={state.error as DataIssue} />
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

      {GROUPS.map((g) => {
        const rows = d.ratios.filter((r) => r.group === g && r.applicable);
        if (rows.length === 0) return null;
        return (
          <Panel key={g} title={t.ratios.groups[g]}>
            <div className="grid gap-3 sm:grid-cols-2">
              {rows.map((r) => (
                <RatioCard key={r.key} r={r} payload={d} lang={lang} />
              ))}
            </div>
          </Panel>
        );
      })}

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

function RatioCard({ r, payload, lang }: { r: RatioRow; payload: RatiosPayload; lang: Lang }) {
  const { t } = useI18n();
  // No traffic light on a figure the SEC data itself disagrees about.
  const level = r.value === null || r.note === "revenueAmbiguous" ? null : ratioLevel(r);
  const name = t.ratios.names[r.key];
  return (
    <article className="rounded-lg border border-line bg-panel p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium">{name}</h3>
        {level && <LevelBadge level={level} />}
      </div>
      <p className={`num text-2xl font-semibold ${r.value !== null && r.value < 0 ? "text-down" : ""}`}>{fmtRatio(r.key, r.value, lang)}</p>
      <p className="text-[11px] text-muted">= {t.ratios.formulas[r.key]}</p>
      {r.note && <p className="text-xs text-warn">{t.ratios.notes[r.note]}</p>}
      {r.value === null && !r.note && <p className="text-xs text-muted">{t.ratios.noValue}</p>}

      {r.value !== null && (
        <dl className="space-y-2 text-xs">
          {r.note !== "revenueAmbiguous" && (
            <Comparison
              label={t.ratios.vsSector}
              percentile={r.sector?.percentile}
              text={
                r.sector && payload.peersYear
                  ? fill(t.ratios.sectorText, {
                      p: r.sector.percentile,
                      n: r.sector.n,
                      sic: `${r.sector.sicPrefix}${"x".repeat(4 - r.sector.sicPrefix.length)}`,
                      year: payload.peersYear,
                      m: fmtRatio(r.key, r.sector.median, lang),
                    })
                  : payload.sic
                    ? t.ratios.noSector
                    : t.ratios.noSic
              }
            />
          )}
          <Comparison
            label={t.ratios.vsHistory}
            percentile={r.own?.percentile}
            text={
              r.own
                ? fill(t.ratios.historyText, { p: r.own.percentile, n: r.own.n, m: fmtRatio(r.key, r.own.median, lang) })
                : t.ratios.shortHistory
            }
          />
        </dl>
      )}

      <History r={r} lang={lang} />
      <Explain>{t.ratios.what[r.key]}</Explain>
    </article>
  );
}

function History({ r, lang }: { r: RatioRow; lang: Lang }) {
  const { t } = useI18n();
  const points = r.history.filter((h) => h.value !== null);
  if (points.length < 2) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer select-none link min-h-6 inline-flex items-center">{t.ratios.seeHistory}</summary>
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
