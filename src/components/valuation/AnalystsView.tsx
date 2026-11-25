"use client";

import { useMemo } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtBig, fmtNum, fmtPrice } from "@/lib/format";
import { expectedGrowth } from "@/lib/expectations";
import type { QualityPayload } from "@/lib/qualityData";
import type { AnalystsPayload } from "@/lib/analysts";
import type { Grades } from "@/lib/fmp";
import type { DataIssue, Result } from "@/lib/types";
import type { Resource } from "@/lib/resource";
import { useResource } from "@/lib/useResource";
import { Explain, IssueNote, Panel } from "../ui";

type Lang = "es" | "en";
const pct = (v: number, lang: Lang, d = 1) => `${fmtNum(v * 100, lang, d)}%`;
const spct = (v: number, lang: Lang, d = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtNum(Math.abs(v * 100), lang, d)}%`;
const money = (v: number) => (v < 0 ? `−$${fmtBig(-v)}` : `$${fmtBig(v)}`);
const secIndexUrl = (cik: number, accn: string) => `https://www.sec.gov/Archives/edgar/data/${cik}/${accn.replace(/-/g, "")}/`;

/** Valuation tab: what analysts expect (growth implied by their estimates, price targets, ratings). */
export function ExpectationsPanel({ symbol, price }: { symbol: string; price: number | null }) {
  const { lang } = useI18n();
  const { state: quality } = useResource<QualityPayload>(`/api/sec/quality/${encodeURIComponent(symbol)}`, { shared: true });
  const { state: analysts, retry: retryAnalysts } = useResource<AnalystsPayload>(`/api/analysts/${encodeURIComponent(symbol)}`);
  const q = quality.status === "ok" ? quality.data : null;
  return (
    <div className="space-y-4">
      <ExpectedGrowthPanel q={q} analysts={analysts} onRetry={retryAnalysts} lang={lang} />
      <AnalystsSection analysts={analysts} onRetry={retryAnalysts} price={price} lastFiscal={q?.lastFiscal ?? null} lang={lang} />
    </div>
  );
}


function partIssue(r: Result<unknown>, t: ReturnType<typeof useI18n>["t"]): React.ReactNode {
  if (r.ok) return null;
  if (r.error === "plan_restricted") return <p className="text-sm text-muted">{t.analysts.planRestricted}</p>;
  if (r.error === "not_found") return <p className="text-sm text-muted">{t.analysts.notFound}</p>;
  return <IssueNote issue={r.error} />;
}

function ExpectedGrowthPanel({ q, analysts, onRetry, lang }: { q: QualityPayload | null; analysts: Resource<AnalystsPayload>; onRetry: () => void; lang: Lang }) {
  const { t } = useI18n();
  const G = t.growth;
  const est = analysts.status === "ok" && analysts.data.estimates.ok ? analysts.data.estimates.data : null;
  const exp = useMemo(() => (est ? expectedGrowth(est, q?.lastFiscal ?? null) : null), [est, q]);
  const past = (key: "revenue" | "eps") => q?.growth.find((g) => g.key === key)?.cagr[5] ?? null;

  let body: React.ReactNode;
  if (analysts.status === "loading") body = <div className="h-24 rounded-lg bg-panel-2 animate-pulse" aria-hidden="true" />;
  else if (analysts.status === "error") body = <IssueNote issue={analysts.issue} onRetry={onRetry} />;
  else if (!analysts.data.estimates.ok) body = partIssue(analysts.data.estimates, t);
  else if (!exp || (!exp.revenueCagr && !exp.epsCagr)) body = <p className="text-sm text-muted">{G.none}</p>;
  else
    body = (
      <div className="space-y-3 text-sm leading-relaxed">
        {exp.revenueCagr && (
          <p>
            <span className="font-medium">{fill(G.expected, { n: exp.revenueCagr.years, rev: spct(exp.revenueCagr.value, lang) })}</span>
            {past("revenue") !== null && <span className="text-muted"> {fill(G.vsPast, { past: spct(past("revenue")!, lang) })}</span>}
          </p>
        )}
        {exp.epsCagr && (
          <p>
            <span className="font-medium">{fill(G.expectedEps, { n: exp.epsCagr.years, eps: spct(exp.epsCagr.value, lang) })}</span>
            {past("eps") !== null && <span className="text-muted"> {fill(G.vsPast, { past: spct(past("eps")!, lang) })}</span>}
          </p>
        )}
      </div>
    );
  return <Panel title={G.expectedTitle}>{body}</Panel>;
}

// ---- Analysts -----------------------------------------------------------------------------

const GRADE_KEYS = ["strongBuy", "buy", "hold", "sell", "strongSell"] as const;
const GRADE_STYLE: Record<(typeof GRADE_KEYS)[number], string> = {
  strongBuy: "bg-up",
  buy: "bg-up/60",
  hold: "bg-warn/70",
  sell: "bg-down/60",
  strongSell: "bg-down",
};

function AnalystsSection({
  analysts,
  onRetry,
  price,
  lastFiscal,
  lang,
}: {
  analysts: Resource<AnalystsPayload>;
  onRetry: () => void;
  price: number | null;
  lastFiscal: QualityPayload["lastFiscal"];
  lang: Lang;
}) {
  const { t } = useI18n();
  const A = t.analysts;
  if (analysts.status === "loading") {
    return (
      <Panel title={A.title}>
        <p role="status" className="text-sm text-muted">{A.loading}</p>
        <div className="mt-3 h-32 rounded-lg bg-panel-2 animate-pulse" aria-hidden="true" />
      </Panel>
    );
  }
  if (analysts.status === "error") {
    return (
      <Panel title={A.title}>
        <IssueNote issue={analysts.issue} onRetry={onRetry} />
      </Panel>
    );
  }
  const { estimates, target, grades } = analysts.data;
  const parts = [estimates, target, grades];
  const allSame = parts.every((r) => !r.ok) && parts.every((r) => !r.ok && r.error === (parts[0] as { error: DataIssue }).error);
  return (
    <Panel title={A.title}>
      {allSame ? (
        partIssue(parts[0], t)
      ) : (
        <div className="space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold">{A.target}</h3>
              <div className="mt-2">{!target.ok ? partIssue(target, t) : price !== null ? <PriceTargetView t={target.data} price={price} lang={lang} /> : <p className="text-sm">{fill(A.targetNoPrice, { consensus: fmtPrice(target.data.consensus, lang) })}</p>}</div>
            </div>
            <div>
              <h3 className="text-sm font-semibold">{A.ratings}</h3>
              <div className="mt-2">{grades.ok ? <GradesView g={grades.data} /> : partIssue(grades, t)}</div>
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold">{A.estimatesTitle}</h3>
            <div className="mt-2">{estimates.ok ? <EstimatesTable analysts={analysts.data} lastFiscal={lastFiscal} lang={lang} /> : partIssue(estimates, t)}</div>
          </div>
          <p className="text-xs text-muted">{A.caution}</p>
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted">{fill(A.source, { time: fmtAsOf(analysts.fetchedAt, lang) })}</p>
    </Panel>
  );
}

function PriceTargetView({ t: pt, price, lang }: { t: { consensus: number; median?: number; high?: number; low?: number }; price: number; lang: Lang }) {
  const { t } = useI18n();
  const A = t.analysts;
  const lo = Math.min(pt.low ?? pt.consensus, price, pt.consensus);
  const hi = Math.max(pt.high ?? pt.consensus, price, pt.consensus);
  const at = (v: number) => (hi > lo ? ((v - lo) / (hi - lo)) * 100 : 50);
  const d = pt.consensus / price - 1;
  return (
    <div>
      <p className="text-sm">
        {fill(A.targetText, { consensus: fmtPrice(pt.consensus, lang), d: spct(d, lang), price: fmtPrice(price, lang) })}
      </p>
      {pt.low !== undefined && pt.high !== undefined && (
        <>
          <div className="relative mt-4 mb-6 h-2 rounded-full bg-panel-2" aria-hidden="true">
            <div className="absolute inset-y-0 rounded-full bg-info/30" style={{ left: `${at(pt.low)}%`, right: `${100 - at(pt.high)}%` }} />
            <div className="absolute -top-1 h-4 w-1 rounded bg-info" style={{ left: `calc(${at(pt.consensus)}% - 2px)` }} />
            <div className="absolute -top-1.5 h-5 w-1 rounded bg-fg" style={{ left: `calc(${at(price)}% - 2px)` }} />
            <span
              className={`absolute top-4 text-[10px] text-muted whitespace-nowrap ${at(price) < 15 ? "" : at(price) > 85 ? "-translate-x-full" : "-translate-x-1/2"}`}
              style={{ left: `${at(price)}%` }}
            >
              {A.current}
            </span>
          </div>
          <p className="text-xs text-muted">{fill(A.targetRange, { low: fmtPrice(pt.low, lang), high: fmtPrice(pt.high, lang) })}</p>
        </>
      )}
    </div>
  );
}

function GradesView({ g }: { g: Grades }) {
  const { t } = useI18n();
  const A = t.analysts;
  const total = GRADE_KEYS.reduce((s, k) => s + g[k], 0);
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-panel-2" aria-hidden="true">
        {GRADE_KEYS.map((k) => (g[k] > 0 ? <div key={k} className={GRADE_STYLE[k]} style={{ width: `${(g[k] / total) * 100}%` }} /> : null))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {GRADE_KEYS.map((k) => (
          <li key={k} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${GRADE_STYLE[k]}`} aria-hidden="true" />
            {A.grades[k]}: <span className="num font-semibold">{g[k]}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">
        {fill(A.ratingsText, { n: total })}
        {g.consensus && <> · {fill(A.consensus, { c: g.consensus })}</>}
      </p>
    </div>
  );
}

function EstimatesTable({ analysts, lastFiscal, lang }: { analysts: AnalystsPayload; lastFiscal: QualityPayload["lastFiscal"]; lang: Lang }) {
  const { t } = useI18n();
  const A = t.analysts;
  const est = analysts.estimates.ok ? analysts.estimates.data : [];
  // Fiscal years after the last one filed with the SEC, with the same growth basis as the headline.
  const byDate = new Map(est.map((e) => [e.date, e]));
  const rows = expectedGrowth(est, lastFiscal).years.map((y) => ({ y, r: byDate.get(y.date)! }));
  const monthYear = (d: string) =>
    new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"));
  if (rows.length === 0) return <p className="text-sm text-muted">{A.notFound}</p>;
  const few = rows.some(({ r }) => (r.analystsEps ?? r.analystsRevenue ?? 99) < 3);
  return (
    <>
      <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label={A.estimatesTitle}>
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th scope="col" className="py-1.5 pr-3 text-left font-normal">{A.cols.year}</th>
              <th scope="col" className="py-1.5 px-2 text-right font-normal">{A.cols.revenue}</th>
              <th scope="col" className="py-1.5 px-2 text-right font-normal">{A.cols.revenueGrowth}</th>
              <th scope="col" className="py-1.5 px-2 text-right font-normal">{A.cols.eps}</th>
              <th scope="col" className="py-1.5 px-2 text-right font-normal">{A.cols.epsGrowth}</th>
              <th scope="col" className="py-1.5 pl-2 text-right font-normal">{A.cols.analysts}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ y, r }) => {
              const rg = y.revenueGrowth;
              const eg = y.epsGrowth;
              const n = r.analystsEps ?? r.analystsRevenue;
              return (
                <tr key={r.date} className="border-t border-line align-top">
                  <th scope="row" className="py-2 pr-3 text-left font-medium">{monthYear(r.date)}</th>
                  <td className="num py-2 px-2 text-right">
                    {r.revenue ? money(r.revenue.avg) : "—"}
                    {r.revenue?.low !== undefined && r.revenue.high !== undefined && (
                      <span className="block text-[11px] text-muted">{fill(A.range, { low: money(r.revenue.low), high: money(r.revenue.high) })}</span>
                    )}
                  </td>
                  <td className="num py-2 px-2 text-right">{rg === null ? "—" : spct(rg, lang)}</td>
                  <td className="num py-2 px-2 text-right">
                    {r.eps ? fmtPrice(r.eps.avg, lang) : "—"}
                    {r.eps?.low !== undefined && r.eps.high !== undefined && (
                      <span className="block text-[11px] text-muted">{fill(A.range, { low: fmtPrice(r.eps.low, lang), high: fmtPrice(r.eps.high, lang) })}</span>
                    )}
                  </td>
                  <td className="num py-2 px-2 text-right">{eg === null ? "—" : spct(eg, lang)}</td>
                  <td className={`num py-2 pl-2 text-right ${n !== undefined && n < 3 ? "text-warn" : ""}`}>{n ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {few && <p className="mt-2 text-xs text-warn">{A.fewAnalysts}</p>}
      <p className="mt-2 text-xs text-muted">{A.epsNote}</p>
    </>
  );
}

// ---- Trends -------------------------------------------------------------------------------
