"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtBig, fmtDate, fmtNum, fmtPrice } from "@/lib/format";
import { dcf, dcfIssue, impliedGrowth, type DcfIssue, type Scenarios } from "@/lib/dcf";
import type { MultipleRow, ValuationPayload } from "@/lib/valuationData";
import type { MultipleKey } from "@/lib/valuation";
import type { DataIssue, Result } from "@/lib/types";
import { Comparison, Explain, IssueNote, Panel } from "./ui";

type Lang = "es" | "en";
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

export default function ValuationPanel({ symbol }: { symbol: string }) {
  const { t, lang } = useI18n();
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

  if (state === null) {
    return (
      <Panel title={t.valuation.title}>
        <p role="status" className="text-sm text-muted">{t.valuation.loading}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-40 rounded-lg bg-panel-2 animate-pulse" />)}
        </div>
      </Panel>
    );
  }
  if (!state.ok) {
    return (
      <Panel title={t.valuation.title}>
        <IssueNote issue={state.error as DataIssue} />
      </Panel>
    );
  }

  const v = state.data;
  const shown = v.multiples.filter((m) => m.applicable);
  const notApplicable = v.multiples.filter((m) => !m.applicable).map((m) => t.valuation.names[m.key]);
  const historyIssue = v.history.issue && v.history.issue in t.valuation.historyIssues
    ? t.valuation.historyIssues[v.history.issue as keyof typeof t.valuation.historyIssues]
    : null;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{t.valuation.title}</h2>
        <p className="text-sm">
          {v.ttm
            ? fill(t.valuation.basis, { price: fmtPrice(v.price, lang), cap: money(v.marketCap), ttm: v.ttm.label })
            : t.valuation.noTtm}
        </p>
      </div>

      <Panel>
        {historyIssue && <p className="mb-3 text-xs text-muted">{historyIssue}</p>}
        {v.history.issue && !historyIssue && <IssueNote issue={v.history.issue as DataIssue} className="mb-3" />}
        <div className="grid gap-3 sm:grid-cols-2">
          {shown.map((m) => (
            <MultipleCard key={m.key} m={m} v={v} lang={lang} />
          ))}
        </div>
        <div className="mt-3 space-y-1 text-[11px] text-muted">
          {notApplicable.length > 0 && <p>{fill(t.valuation.notApplicable, { list: notApplicable.join(", ") })}</p>}
          {v.peers.issue && (
            <p>
              {t.valuation.vsPeers}:{" "}
              {v.peers.issue in t.valuation.peersIssues
                ? t.valuation.peersIssues[v.peers.issue as keyof typeof t.valuation.peersIssues]
                : t.data.issues[v.peers.issue as DataIssue]}
            </p>
          )}
        </div>
      </Panel>

      <DcfSection v={v} lang={lang} />

      <div className="space-y-1 text-[11px] text-muted">
        <p>{fill(t.valuation.sources, { time: fmtAsOf(v.quoteAt, lang) })}</p>
        <p>{t.valuation.disclaimer}</p>
      </div>
    </div>
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

// ---- DCF -------------------------------------------------------------------------------

const toInput = (v: number | null) => (v === null ? "" : String(Math.round(v * 10_000) / 100));
const fromInput = (s: string) => {
  const n = Number(s.replace(",", "."));
  return s.trim() === "" || !Number.isFinite(n) ? null : n / 100;
};

function DcfSection({ v, lang }: { v: ValuationPayload; lang: Lang }) {
  const { t } = useI18n();
  const d = v.dcf;
  const initial = () => ({
    r: toInput(d.defaults.r),
    gT: toInput(d.defaults.gT),
    bear: toInput(d.defaults.scenarios.bear),
    base: toInput(d.defaults.scenarios.base),
    bull: toInput(d.defaults.scenarios.bull),
  });
  const [inputs, setInputs] = useState(initial);

  if (d.issue) {
    return (
      <Panel title={t.valuation.reverseTitle}>
        <p className="text-sm text-muted">{t.valuation.dcfIssues[d.issue]}</p>
      </Panel>
    );
  }
  const fcf0 = d.fcf0!;
  const r = fromInput(inputs.r);
  const gT = fromInput(inputs.gT);
  const issue: DcfIssue | null = r === null || gT === null ? "badRate" : dcfIssue({ fcf0, r, gT });
  const ready = issue === null && r !== null && gT !== null;
  const implied = ready ? impliedGrowth({ fcf0, r, gT }, v.marketCap) : null;
  const scenarios = (["bear", "base", "bull"] as const).map((name) => {
    const g1 = fromInput(inputs[name]);
    if (!ready || g1 === null) return { name, g1, result: null };
    const res = dcf({ fcf0, r, gT, g1 });
    return { name, g1, result: { ...res, perShare: (res.value / v.marketCap) * v.price } };
  });
  const set = (k: keyof ReturnType<typeof initial>) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setInputs((s) => ({ ...s, [k]: e.target.value }));

  return (
    <>
      <Panel title={t.valuation.reverseTitle}>
        {!ready && <p className="text-sm text-muted">{t.valuation.checkInputs}</p>}
        {implied && (
          <p className="text-sm leading-relaxed" aria-live="polite">
            {implied.g !== null
              ? fill(t.valuation.reverseText, {
                  cap: money(v.marketCap),
                  fcf: money(fcf0),
                  g: pct(implied.g, lang),
                  gT: pct(gT!, lang),
                  r: pct(r!, lang, 2),
                })
              : implied.bound === "above"
                ? t.valuation.reverseAbove
                : t.valuation.reverseBelow}
          </p>
        )}
        {d.revenueCagr5 !== null && (
          <p className="mt-1 text-xs text-muted">{fill(t.valuation.reverseContext, { c: pct(d.revenueCagr5, lang) })}</p>
        )}
      </Panel>

      <Panel title={t.valuation.dcfTitle}>
        <p className="text-xs text-muted mb-3">{t.valuation.dcfIntro}</p>
        {d.ratesIssue && <p className="text-xs text-warn mb-2">{t.valuation.ratesMissing}</p>}
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-5">
          <PctInput label={t.valuation.inputs.r} value={inputs.r} onChange={set("r")} />
          <PctInput label={t.valuation.inputs.gT} value={inputs.gT} onChange={set("gT")} />
          {(["bear", "base", "bull"] as const).map((name) => (
            <PctInput
              key={name}
              label={`${t.valuation.inputs.growth}: ${t.valuation.scenarios[name]}`}
              value={inputs[name]}
              onChange={set(name)}
            />
          ))}
        </div>
        {!ready && issue && <p className="mt-2 text-xs text-warn">{t.valuation.invalid[issue]}</p>}

        <div className="mt-4 overflow-x-auto">
          <table className="num text-sm w-full min-w-[30rem]">
            <caption className="sr-only">{t.valuation.dcfTitle}</caption>
            <thead>
              <tr className="text-muted text-xs">
                <th scope="col" className="text-left font-normal py-1">{t.valuation.table.scenario}</th>
                <th scope="col" className="text-right font-normal">{t.valuation.table.growth}</th>
                <th scope="col" className="text-right font-normal">{t.valuation.table.value}</th>
                <th scope="col" className="text-right font-normal">{t.valuation.table.vsPrice}</th>
                <th scope="col" className="text-right font-normal">{t.valuation.table.terminal}</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s) => {
                const diff = s.result ? s.result.perShare / v.price - 1 : null;
                return (
                  <tr key={s.name} className="border-t border-line">
                    <th scope="row" className="text-left font-sans font-medium py-1.5">{t.valuation.scenarios[s.name]}</th>
                    <td className="text-right">{s.g1 === null ? "—" : pct(s.g1, lang)}</td>
                    <td className="text-right">{s.result ? fmtPrice(s.result.perShare, lang) : "—"}</td>
                    <td className={`text-right ${diff === null ? "" : diff >= 0 ? "text-up" : "text-down"}`}>
                      {diff === null ? "—" : `${diff >= 0 ? "+" : ""}${pct(diff, lang)}`}
                    </td>
                    <td className="text-right">{s.result ? pct(s.result.pvTerminal / s.result.value, lang, 0) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <button
          type="button"
          onClick={() => setInputs(initial())}
          className="mt-3 h-9 px-3 rounded-md text-xs font-semibold border border-line bg-panel hover:bg-panel-2"
        >
          {t.valuation.reset}
        </button>

        <div className="mt-3 space-y-1 text-[11px] text-muted">
          <p>{t.valuation.model}</p>
          {d.rf && d.erp && (
            <p>
              {fill(t.valuation.rates, {
                rf: pct(d.rf.value, lang, 2),
                date: fmtDate(d.rf.date, lang),
                erp: pct(d.erp.value, lang, 2),
                c: d.revenueCagr5 === null ? t.valuation.noCagr : pct(d.revenueCagr5, lang),
              })}
            </p>
          )}
        </div>
      </Panel>
    </>
  );
}

function PctInput({ label, value, onChange }: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11px] text-muted leading-tight">{label}</label>
      <div className="relative">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step="0.5"
          value={value}
          onChange={onChange}
          className="num h-10 w-full rounded-md border border-line bg-panel px-2 pr-6 text-sm"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted" aria-hidden="true">%</span>
      </div>
    </div>
  );
}
