"use client";

import { useMemo } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtBig, fmtNum, fmtPrice } from "@/lib/format";
import { THRESHOLDS, type QualityCheck, type QualityLevel } from "@/lib/quality";
import { expectedGrowth } from "@/lib/expectations";
import type { QualityPayload, TrendKey } from "@/lib/qualityData";
import type { AnalystsPayload } from "@/lib/analysts";
import type { Grades } from "@/lib/fmp";
import type { DataIssue, Result } from "@/lib/types";
import type { Resource } from "@/lib/resource";
import { useResource } from "@/lib/useResource";
import { Explain, IssueNote, Panel } from "../ui";
import RatiosPanel from "../RatiosPanel";
import TrendBars from "./TrendBars";
import { CheckIcon, CloseIcon } from "../icons";

type Lang = "es" | "en";
const pct = (v: number, lang: Lang, d = 1) => `${fmtNum(v * 100, lang, d)}%`;
const spct = (v: number, lang: Lang, d = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtNum(Math.abs(v * 100), lang, d)}%`;
const money = (v: number) => (v < 0 ? `−$${fmtBig(-v)}` : `$${fmtBig(v)}`);
const secIndexUrl = (cik: number, accn: string) => `https://www.sec.gov/Archives/edgar/data/${cik}/${accn.replace(/-/g, "")}/`;

/** Fundamentals for a long-term investor: quality, growth, expectations and 10-year trends. */
export default function FundamentalsPanel({ symbol, price }: { symbol: string; price: number | null }) {
  const { t, lang } = useI18n();
  const { state: quality, retry: retryQuality } = useResource<QualityPayload>(`/api/sec/quality/${encodeURIComponent(symbol)}`);
  const { state: analysts, retry: retryAnalysts } = useResource<AnalystsPayload>(`/api/analysts/${encodeURIComponent(symbol)}`);
  const q = quality.status === "ok" ? quality.data : null;

  return (
    <div className="space-y-4">
      {quality.status === "loading" ? (
        <Panel>
          <p role="status" className="text-sm text-muted">{t.quality.loading}</p>
          <div className="mt-3 h-48 rounded-lg bg-panel-2 animate-pulse" aria-hidden="true" />
        </Panel>
      ) : quality.status === "error" ? (
        <Panel title={t.quality.title}>
          <IssueNote issue={quality.issue} onRetry={retryQuality} />
        </Panel>
      ) : (
        <QualitySection q={quality.data} lang={lang} />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {q && <PastGrowth q={q} lang={lang} />}
        <ExpectedGrowthPanel q={q} analysts={analysts} onRetry={retryAnalysts} lang={lang} />
      </div>

      <AnalystsSection analysts={analysts} onRetry={retryAnalysts} price={price} lastFiscal={q?.lastFiscal ?? null} lang={lang} />

      {q && q.trends.length > 0 && <Trends q={q} lang={lang} />}

      <RatiosPanel symbol={symbol} />
    </div>
  );
}

// ---- Quality ------------------------------------------------------------------------------

const LEVEL_DOT: Record<QualityLevel, string> = {
  high: "bg-up",
  mixed: "bg-warn",
  low: "bg-down",
  na: "bg-line-strong",
};
const STATUS_STYLE: Record<QualityCheck["status"], string> = {
  pass: "bg-up-bg text-up",
  fail: "bg-down-bg text-down",
  na: "bg-panel-2 text-muted",
};
const STATUS_TEXT: Record<QualityCheck["status"], string> = { pass: "text-up", fail: "text-down", na: "text-muted" };
const STATUS_ICON: Record<QualityCheck["status"], React.ReactNode> = {
  pass: <CheckIcon size={14} />,
  fail: <CloseIcon size={14} />,
  na: <span className="h-px w-2.5 bg-current" />,
};

function QualitySection({ q, lang }: { q: QualityPayload; lang: Lang }) {
  const { t } = useI18n();
  const Q = t.quality;
  const s = q.summary;
  const judged = s.passed + s.failed;
  const first = q.years[0];
  const last = q.years[q.years.length - 1];
  const latest10k = [...q.years].reverse().find((y) => y.accn && (y.form ?? "").startsWith("10-K"));
  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h2 className="section-title">{Q.title}</h2>
          <p className="mt-1 text-sm text-muted leading-relaxed">{Q.intro}</p>
        </div>
        {q.checks.length > 0 && (
          <div className="sm:text-right">
            <p className="num text-3xl font-semibold tracking-tight leading-none" aria-hidden="true">
              {s.passed}
              <span className="text-xl font-normal text-muted">/{judged}</span>
            </p>
            <p className="mt-1 text-xs text-muted">{fill(Q.score, { passed: s.passed, judged })}</p>
            {s.na > 0 && <p className="text-xs text-muted">{fill(Q.scoreNa, { na: s.na })}</p>}
          </div>
        )}
      </div>
      {q.checks.length > 0 && (
        <p className="mt-3 inline-flex items-center gap-2 text-sm font-medium">
          <span className={`h-2 w-2 rounded-full ${LEVEL_DOT[s.level]}`} aria-hidden="true" />
          {Q.level[s.level]}
        </p>
      )}
      <p className="mt-2 text-xs text-muted">
        {first && last && fill(Q.years, { from: first.label, to: last.label })}
        {latest10k && (
          <>
            {" · "}
            <a href={secIndexUrl(q.cik, latest10k.accn!)} target="_blank" rel="noopener noreferrer" className="link">
              {Q.latest10k} ({latest10k.label})
            </a>
          </>
        )}
      </p>
      {q.businessType === "reit" && <p className="mt-3 text-sm">{Q.reit}</p>}
      {(q.businessType === "bank" || q.businessType === "insurance") && <p className="mt-2 text-xs text-muted">{Q.financial}</p>}
      {q.checks.length > 0 && (
        <ul className="mt-5 grid md:grid-cols-2 md:gap-x-8 border-t border-line md:border-t-0">
          {q.checks.map((c) => (
            <CheckItem key={c.key} c={c} lang={lang} />
          ))}
        </ul>
      )}
      {q.splitAdjusted && <p className="mt-3 text-xs text-muted">{Q.split}</p>}
      <p className="mt-3 text-[11px] text-muted">{Q.source}</p>
    </Panel>
  );
}

function barFor(key: QualityCheck["key"], lang: Lang): string {
  switch (key) {
    case "roic":
    case "roe":
    case "roa":
    case "grossMargin":
    case "cashConversion":
    case "capex":
    case "interest":
      return pct(THRESHOLDS[key], lang, 0);
    case "debt":
      return fmtNum(THRESHOLDS.debtYears, lang, 0);
    default:
      return "";
  }
}

function checkText(c: QualityCheck, lang: Lang, t: ReturnType<typeof useI18n>["t"]): string {
  const f = c.facts;
  const bar = barFor(c.key, lang);
  if (c.status === "na") return t.quality.naText;
  switch (c.key) {
    case "roic":
    case "roe":
    case "roa": {
      const d = t.quality.checks[c.key];
      return fill(d.result, { bar, count: f.count, n: f.n, median: pct(f.median, lang), latest: pct(f.latest, lang) });
    }
    case "grossMargin":
      return fill(t.quality.checks.grossMargin.result, {
        median: pct(f.median, lang),
        latest: pct(f.latest, lang),
        min: pct(f.min, lang),
        max: pct(f.max, lang),
      });
    case "epsGrowth":
    case "bookValue": {
      const d = t.quality.checks[c.key];
      const vars = { ups: f.ups, pairs: f.pairs, first: fmtPrice(f.first, lang), last: fmtPrice(f.last, lang) };
      return f.cagr !== undefined ? fill(d.result, { ...vars, cagr: spct(f.cagr, lang) }) : fill(d.resultNoCagr, vars);
    }
    case "cashConversion":
    case "capex": {
      const d = t.quality.checks[c.key];
      return f.noProfit ? d.noProfit : fill(d.result, { ratio: pct(f.ratio, lang, 0), n: f.n });
    }
    case "debt": {
      const d = t.quality.checks.debt;
      if (f.debt === 0) return d.noDebt;
      if (f.noProfit) return fill(d.noProfit, { debt: money(f.debt) });
      return fill(d.result, { debt: money(f.debt), years: fmtNum(f.years, lang, 1), income: money(f.income) });
    }
    case "interest": {
      const d = t.quality.checks.interest;
      if (f.noProfit) return fill(d.noProfit, { interest: money(f.interest), year: c.to ?? "" });
      return fill(d.result, { ratio: pct(f.ratio, lang), year: c.to ?? "" });
    }
    case "buybacks":
      return fill(t.quality.checks.buybacks.result, {
        change: spct(f.change, lang),
        from: c.from ?? "",
        cagr: f.cagr !== undefined ? spct(f.cagr, lang) : "—",
      });
  }
}

function CheckItem({ c, lang }: { c: QualityCheck; lang: Lang }) {
  const { t } = useI18n();
  const d = t.quality.checks[c.key];
  return (
    <li className="border-b border-line py-4 md:[&:nth-child(-n+2)]:border-t">
      <div className="flex gap-3">
        <span className={`mt-px grid h-6 w-6 shrink-0 place-items-center rounded-full ${STATUS_STYLE[c.status]}`} aria-hidden="true">
          {STATUS_ICON[c.status]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-sm font-medium">{d.title}</h3>
            <span className={`shrink-0 text-xs font-medium ${STATUS_TEXT[c.status]}`}>{t.quality.status[c.status]}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted leading-relaxed">{fill(d.rule, { bar: barFor(c.key, lang) })}</p>
          <p className="num mt-1.5 text-sm">{checkText(c, lang, t)}</p>
          <Explain>{d.why}</Explain>
        </div>
      </div>
    </li>
  );
}

// ---- Growth -------------------------------------------------------------------------------

function PastGrowth({ q, lang }: { q: QualityPayload; lang: Lang }) {
  const { t } = useI18n();
  const G = t.growth;
  return (
    <Panel title={G.pastTitle}>
      <div className="relative overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th scope="col" className="py-1.5 pr-3 text-left font-normal">{G.cols.metric}</th>
              <th scope="col" className="py-1.5 px-2 text-right font-normal">{G.cols.y3}</th>
              <th scope="col" className="py-1.5 px-2 text-right font-normal">{G.cols.y5}</th>
              <th scope="col" className="py-1.5 pl-2 text-right font-normal">{G.cols.y10}</th>
            </tr>
          </thead>
          <tbody>
            {q.growth.map((g) => (
              <tr key={g.key} className="border-t border-line">
                <th scope="row" className="py-2 pr-3 text-left font-medium">{G.rows[g.key]}</th>
                {([3, 5, 10] as const).map((span) => {
                  const v = g.cagr[span];
                  return (
                    <td key={span} className={`num py-2 px-2 text-right ${v !== null && v < 0 ? "text-down" : ""}`}>
                      {v === null ? "—" : spct(v, lang)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-muted">
        {q.lastFiscal && fill(G.pastNote, { year: q.lastFiscal.label })} {G.noValue}
      </p>
    </Panel>
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

type Kind = "money" | "perShare" | "pct" | "count";
const KIND: Record<TrendKey, Kind> = {
  revenue: "money",
  netIncome: "money",
  fcf: "money",
  eps: "perShare",
  bookValue: "perShare",
  grossMargin: "pct",
  operatingMargin: "pct",
  netMargin: "pct",
  fcfMargin: "pct",
  roic: "pct",
  roe: "pct",
  roa: "pct",
  shares: "count",
};

function Trends({ q, lang }: { q: QualityPayload; lang: Lang }) {
  const { t } = useI18n();
  const T = t.trends;
  const labels = q.years.map((y) => y.label);
  const fmt = (kind: Kind) => (v: number) =>
    kind === "money" ? money(v) : kind === "perShare" ? fmtPrice(v, lang) : kind === "pct" ? pct(v, lang) : fmtBig(v);
  return (
    <Panel title={T.title}>
      <p className="-mt-1 mb-3 text-xs text-muted">{T.intro}</p>
      <div className="grid gap-x-6 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
        {q.trends.map(({ key, values }) => {
          const kind = KIND[key];
          const format = fmt(kind);
          const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
          if (pts.length < 2) return null;
          const first = pts[0];
          const last = pts[pts.length - 1];
          const yrs = (Date.parse(q.years[last.i].end) - Date.parse(q.years[first.i].end)) / (365.25 * 86_400_000);
          let note: string | undefined;
          if (kind === "pct") {
            const s = pts.map((p) => p.v).sort((a, b) => a - b);
            const m = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
            note = fill(T.median, { v: pct(m, lang) });
          } else if (kind === "count") {
            note = fill(T.total, { v: spct(last.v / first.v - 1, lang) });
          } else if (first.v > 0 && last.v > 0 && yrs >= 0.9) {
            note = fill(T.perYear, { v: spct((last.v / first.v) ** (1 / yrs) - 1, lang) });
          }
          const name = T.names[key];
          return (
            <TrendBars
              key={key}
              title={name}
              headline={`${format(last.v)} (${labels[last.i]})`}
              note={note}
              labels={labels}
              values={values}
              format={format}
              summary={fill(T.summary, { name, from: labels[first.i], to: labels[last.i], first: format(first.v), last: format(last.v) })}
            />
          );
        })}
      </div>
    </Panel>
  );
}
