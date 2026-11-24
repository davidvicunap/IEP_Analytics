"use client";

import { useMemo } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtBig, fmtNum } from "@/lib/format";
import { KEY_METRICS, cagr, findings, fmtPerShare, metricSeries, type Finding, type KeyMetric } from "@/lib/financialsView";
import type { StatementSet } from "@/lib/secFinancials";
import { useFinancials } from "./financialsHooks";
import { IssueNote, Skeleton } from "./ui";

type Lang = "es" | "en";
const SPAN = 5;
const BARS = 10;

const money = (v: number) => (v < 0 ? `−$${fmtBig(-v)}` : `$${fmtBig(v)}`);
const pct = (v: number, lang: Lang, digits = 1) => `${fmtNum(v * 100, lang, digits)}%`;
const signedPct = (v: number, lang: Lang) => `${v >= 0 ? "+" : "−"}${pct(Math.abs(v), lang)}`;

/**
 * The financials at a glance, all from the 10-Ks: six figures with their last ten years, then
 * what they add up to in plain sentences, each with the years and amounts it rests on.
 */
export default function FinancialHighlights({ symbol }: { symbol: string }) {
  const { t, lang } = useI18n();
  const { state, retry } = useFinancials(symbol);

  if (state.status === "loading") {
    return (
      <div className="space-y-4" aria-busy="true">
        <p role="status" className="sr-only">{t.fin.loading}</p>
        <Skeleton className="h-6 w-40" />
        <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {KEY_METRICS.map((m) => (
            <Skeleton key={m} className="h-32" />
          ))}
        </div>
      </div>
    );
  }
  if (state.status === "error") return <IssueNote issue={state.issue} onRetry={retry} />;

  const annual = state.data.annual;
  if (annual.periods.length < 2) return <p className="text-sm text-muted">{t.fin.hl.noHistory}</p>;
  return <Highlights annual={annual} fetchedAt={state.fetchedAt} lang={lang} />;
}

function Highlights({ annual, fetchedAt, lang }: { annual: StatementSet; fetchedAt: string; lang: Lang }) {
  const { t } = useI18n();
  const hl = t.fin.hl;
  const found = useMemo(() => findings(annual, SPAN), [annual]);
  const labels = annual.periods.map((p) => p.label);

  const sentence = (f: Finding): string => {
    switch (f.kind) {
      case "growth":
        return fill(f.cagr >= 0 ? hl.growthUp : hl.growthDown, { g: pct(Math.abs(f.cagr), lang), from: f.fromLabel, to: f.toLabel, a: money(f.from), b: money(f.to) });
      case "margin": {
        const d = f.to - f.from;
        const tpl = Math.abs(d) < 0.005 ? hl.marginFlat : d > 0 ? hl.marginUp : hl.marginDown;
        return fill(tpl, { a: pct(f.from, lang), b: pct(f.to, lang), from: f.fromLabel, to: f.toLabel });
      }
      case "cashConversion":
        return fill(hl.cashConversion, { r: `${f.ratio < 0 ? "−" : ""}$${fmtNum(Math.abs(f.ratio), lang, 2)}`, n: String(f.years) });
      case "shares":
        return fill(Math.abs(f.change) < 0.01 ? hl.sharesFlat : f.change < 0 ? hl.sharesDown : hl.sharesUp, { p: pct(Math.abs(f.change), lang), n: String(f.years) });
      case "payout":
        return fill(hl.payout, { p: pct(f.share, lang, 0), n: String(f.years), a: money(f.returned) });
      case "netCash":
        return fill(hl.netCash, { a: money(f.amount), p: f.label });
      case "netDebt":
        return f.fcfYears === null
          ? fill(hl.netDebtNoFcf, { a: money(f.amount), p: f.label })
          : fill(hl.netDebt, { a: money(f.amount), p: f.label, y: fmtNum(f.fcfYears, lang, 1) });
      case "stockComp":
        return f.ofFcf === null
          ? fill(hl.stockComp, { r: pct(f.ofRevenue, lang), p: f.label })
          : fill(hl.stockCompFcf, { r: pct(f.ofRevenue, lang), f: pct(f.ofFcf, lang, 0), p: f.label });
      case "rnd":
        return fill(hl.rnd, { r: pct(f.ofRevenue, lang), p: f.label });
    }
  };

  return (
    <div className="space-y-10">
      <section aria-labelledby="hl-key">
        <h2 id="hl-key" className="section-title">{hl.keyTitle}</h2>
        <p className="mt-1 text-[13px] text-muted">{hl.keyIntro}</p>
        <div className="mt-4 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
          {KEY_METRICS.map((m) => (
            <Metric key={m} metric={m} series={metricSeries(annual, m)} labels={labels} lang={lang} />
          ))}
        </div>
      </section>

      {found.length > 0 && (
        <section aria-labelledby="hl-says">
          <h2 id="hl-says" className="section-title">{hl.saysTitle}</h2>
          <ul className="mt-3 max-w-[68ch] divide-y divide-line border-y border-line">
            {found.map((f) => (
              <li key={f.kind} className="py-3 text-[15px] leading-relaxed">
                {sentence(f)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="max-w-[80ch] space-y-1 text-[11px] leading-relaxed text-muted">
        <p>{fill(hl.method, { n: String(SPAN) })}</p>
        <p>
          {hl.source} · {t.data.updated} <time dateTime={fetchedAt}>{fmtAsOf(fetchedAt, lang)}</time>
        </p>
      </div>
    </div>
  );
}

function Metric({ metric, series, labels, lang }: { metric: KeyMetric; series: (number | null)[]; labels: string[]; lang: Lang }) {
  const { t } = useI18n();
  const hl = t.fin.hl;
  const last = series.length - 1;
  const latest = series[last];
  const fmt = (v: number) =>
    metric === "operatingMargin"
      ? pct(v, lang)
      : metric === "epsDiluted"
        ? `${v < 0 ? "−" : ""}$${fmtPerShare(Math.abs(v), lang)}`
        : metric === "dilutedShares"
          ? fmtBig(v)
          : money(v);
  const back = last - SPAN;
  const change =
    back < 0
      ? null
      : metric === "operatingMargin"
        ? series[back] !== null && latest !== null
          ? fill(hl.marginChange, { d: `${latest - series[back]! >= 0 ? "+" : "−"}${fmtNum(Math.abs(latest - series[back]!) * 100, lang, 1)}` })
          : null
        : (() => {
            const g = cagr(series[back], latest, SPAN);
            return g === null ? null : fill(hl.cagr, { g: signedPct(g, lang) });
          })();
  const shown = series.slice(-BARS);
  const shownLabels = labels.slice(-BARS);

  return (
    <div className="border-t border-line py-4">
      <h3 className="text-[13px] font-medium text-muted">{hl.metrics[metric]}</h3>
      <p className="num mt-1 text-[26px] font-semibold leading-none tracking-[-0.02em]">{latest === null ? "—" : fmt(latest)}</p>
      <p className="num mt-1.5 text-[12px] text-muted">
        {labels[last]}
        {change && <> · {change}</>}
      </p>
      <Bars values={shown} labels={shownLabels} format={fmt} />
    </div>
  );
}

/** Ten years as bars, the latest in full colour; each bar names its year and value on hover. */
function Bars({ values, labels, format }: { values: (number | null)[]; labels: string[]; format: (v: number) => string }) {
  const { t } = useI18n();
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return null;
  const max = Math.max(0, ...nums);
  const min = Math.min(0, ...nums);
  const span = max - min || 1;
  const H = 48;
  const step = 10;
  const bw = 7;
  const zero = (max / span) * H;
  return (
    <figure className="mt-3">
      <svg viewBox={`0 0 ${values.length * step} ${H}`} preserveAspectRatio="none" className="block h-12 w-full" role="img" aria-label={labels.map((l, i) => (values[i] === null ? null : `${l} ${format(values[i]!)}`)).filter(Boolean).join(", ")}>
        {values.map((v, i) => (
          <g key={labels[i]}>
            <title>{fill(t.fin.hl.barTitle, { p: labels[i], v: v === null ? "—" : format(v) })}</title>
            <rect x={i * step} y={0} width={step} height={H} fill="transparent" />
            {v !== null && (
              <rect
                x={i * step + (step - bw) / 2}
                y={v >= 0 ? zero - (v / span) * H : zero}
                width={bw}
                height={Math.max(0.75, (Math.abs(v) / span) * H)}
                fill={v < 0 ? "var(--down)" : "var(--series-1)"}
                opacity={i === values.length - 1 ? 1 : 0.4}
              />
            )}
          </g>
        ))}
      </svg>
      <figcaption className="num mt-1 flex justify-between text-[11px] text-muted" aria-hidden="true">
        <span>{labels[0]}</span>
        <span>{labels.at(-1)}</span>
      </figcaption>
    </figure>
  );
}
