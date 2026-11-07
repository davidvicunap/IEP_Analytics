"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtBig, fmtDate, fmtNum, fmtPrice } from "@/lib/format";
import { scoreFundamentals, summarize, technicalSignals } from "@/lib/scoring";
import type { StockBundle } from "@/lib/types";
import { IncomeBars, MetricGrid } from "./Fundamentals";
import FinancialStatements from "./FinancialStatements";
import ChartTab from "./ChartTab";
import NewsPanel, { OfficialReleases } from "./NewsPanel";
import FilingsPanel from "./FilingsPanel";
import InsidersPanel from "./InsidersPanel";
import RatiosPanel from "./RatiosPanel";
import ValuationPanel from "./ValuationPanel";
import { Change, Dot, IssueNote, Panel, Provenance, WatchButton } from "./ui";

const PriceChart = dynamic(() => import("./PriceChart"), {
  ssr: false,
  loading: () => <div className="h-[340px] rounded-lg bg-panel-2 animate-pulse" />,
});

type Tab = "overview" | "chart" | "fundamentals" | "valuation" | "financials" | "filings" | "insiders" | "news";
const TABS: Tab[] = ["overview", "chart", "fundamentals", "valuation", "financials", "filings", "insiders", "news"];
// The FMP grid keeps what neither RatiosPanel (SEC ratios) nor ValuationPanel (multiples) covers.
const MARKET_METRICS = new Set(["dividendYield", "currentRatio"]);

export default function StockView({ data }: { data: StockBundle }) {
  const { t, lang } = useI18n();
  const q = data.quote;
  const profile = data.profile.ok ? data.profile.data : null;
  const fundamentals = data.fundamentals.ok ? data.fundamentals.data : null;
  const income = useMemo(() => (data.income.ok ? data.income.data : []), [data.income]);
  const history = useMemo(() => (data.history.ok ? data.history.data : []), [data.history]);
  const [tab, setTab] = useState<Tab>("overview");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const scores = useMemo(() => (fundamentals ? scoreFundamentals(fundamentals, income) : []), [fundamentals, income]);
  const signals = useMemo(() => technicalSignals(history), [history]);
  const summary = useMemo(() => summarize(scores, signals), [scores, signals]);

  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    const n = (i + dir + TABS.length) % TABS.length;
    setTab(TABS[n]);
    tabRefs.current[n]?.focus();
  };

  const ago = (days?: number) =>
    days === undefined ? "" : days === 0 ? t.ago.today : days === 1 ? t.ago.one : fill(t.ago.many, { n: days });

  const signalList = signals.length === 0 ? null : (
    <ul className="space-y-2.5">
      {signals.map((s) => (
        <li key={s.key} className="flex gap-2.5 text-sm">
          <Dot level={s.level} />
          <span>
            {fill(t.signals[s.key], {
              v: s.value !== undefined ? fmtNum(s.value, lang, 0) : "",
              ago: ago(s.days),
              date: s.date ? fmtDate(s.date, lang) : "",
            })}
          </span>
        </li>
      ))}
    </ul>
  );

  const chart = !data.history.ok ? (
    <IssueNote issue={data.history.error} />
  ) : history.length === 0 ? (
    <IssueNote issue="not_found" />
  ) : (
    <PriceChart history={history} />
  );

  const summaryPanel =
    summary.length > 0 ? (
      <Panel title={t.stock.summaryTitle} className="border-accent/50">
        <ul className="space-y-2.5">
          {summary.map((s) => (
            <li key={s.key} className="flex gap-2.5 text-sm">
              <Dot level={s.level} />
              <span>{t.summary[s.key]}</span>
            </li>
          ))}
        </ul>
      </Panel>
    ) : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start gap-3">
        {profile?.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.image} alt="" className="h-12 w-12 rounded-lg bg-white object-contain p-1 border border-line" />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-bold leading-tight truncate">
            {profile?.companyName ?? q.name}
          </h1>
          <p className="text-sm text-muted">
            <span className="num font-bold text-accent">{q.symbol}</span>
            {q.exchange && <> · {q.exchange}</>}
            {profile?.sector && <> · {profile.sector}</>}
          </p>
        </div>
        <WatchButton symbol={q.symbol} />
        <div className="w-full sm:w-auto sm:text-right">
          <p className="num text-3xl font-semibold">{fmtPrice(q.price, lang)}</p>
          <Change value={q.change} pct={q.changePercent} className="text-sm" />
          <Provenance source={data.source} asOf={q.asOf ?? data.quoteFetchedAt} className="mt-1" />
        </div>
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label={q.symbol} className="flex gap-1 overflow-x-auto border-b border-line -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-none">
        {TABS.map((k, i) => (
          <button
            key={k}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            id={`tab-${k}`}
            aria-selected={tab === k}
            aria-controls={`panel-${k}`}
            tabIndex={tab === k ? 0 : -1}
            onClick={() => setTab(k)}
            onKeyDown={(e) => onTabKey(e, i)}
            className={`shrink-0 h-11 px-3 sm:px-4 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === k ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"
            }`}
          >
            {t.stock.tabs[k]}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "overview" && (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-4 min-w-0">
              {summaryPanel && <div className="lg:hidden">{summaryPanel}</div>}
              <Panel>{chart}</Panel>
              {signalList && <Panel title={t.stock.signalsTitle}>{signalList}</Panel>}
            </div>
            <div className="space-y-4 min-w-0">
              {summaryPanel && <div className="hidden lg:block">{summaryPanel}</div>}
              <KeyStats data={data} />
              {!data.profile.ok && (
                <Panel title={t.stock.about}>
                  <IssueNote issue={data.profile.error} />
                </Panel>
              )}
              {profile && (
                <Panel title={t.stock.about}>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                    {profile.industry && (<><dt className="text-muted">{t.stock.industry}</dt><dd>{profile.industry}</dd></>)}
                    {profile.ceo && (<><dt className="text-muted">{t.stock.ceo}</dt><dd>{profile.ceo}</dd></>)}
                    {profile.employees !== undefined && (<><dt className="text-muted">{t.stock.employees}</dt><dd className="num">{fmtNum(profile.employees, lang, 0)}</dd></>)}
                    {profile.website && (
                      <><dt className="text-muted">{t.stock.website}</dt>
                      <dd className="truncate"><a className="text-info underline" href={profile.website} target="_blank" rel="noopener noreferrer">{profile.website.replace(/^https?:\/\//, "")}</a></dd></>
                    )}
                  </dl>
                  {profile.description && (
                    <details className="mt-3 text-sm text-muted">
                      <summary className="cursor-pointer text-info text-xs">+ {t.stock.about}</summary>
                      <p className="mt-2 leading-relaxed">{profile.description}</p>
                    </details>
                  )}
                </Panel>
              )}
              <Panel title={t.news.latest}>
                <OfficialReleases symbol={q.symbol} limit={4} onSeeAll={() => setTab("news")} />
              </Panel>
            </div>
          </div>
        )}

        {tab === "chart" && (
          <ChartTab
            symbol={q.symbol}
            exchange={q.exchange}
            history={history}
            historyIssue={data.history.ok ? (history.length ? null : "not_found") : data.history.error}
            signals={signalList && <Panel title={t.stock.signalsTitle}>{signalList}</Panel>}
          />
        )}

        {tab === "fundamentals" && (
          <div className="space-y-4">
            <RatiosPanel symbol={q.symbol} />
            {data.fundamentals.ok ? (
              <div className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{t.ratios.marketTitle}</h2>
                <MetricGrid scores={scores.filter((s) => MARKET_METRICS.has(s.key))} />
                <Provenance source={data.source} asOf={data.fundamentals.fetchedAt} />
              </div>
            ) : (
              <Panel>
                <IssueNote issue={data.fundamentals.error} />
              </Panel>
            )}
            <IncomeBars income={data.income} source={data.source} />
          </div>
        )}

        {tab === "valuation" && <ValuationPanel symbol={q.symbol} />}

        {tab === "financials" && <FinancialStatements symbol={q.symbol} />}

        {tab === "filings" && <FilingsPanel symbol={q.symbol} />}

        {tab === "insiders" && <InsidersPanel symbol={q.symbol} />}

        {tab === "news" && <NewsPanel symbol={q.symbol} exchange={q.exchange} onSeeAllFilings={() => setTab("filings")} />}
      </div>
    </div>
  );
}

function KeyStats({ data }: { data: StockBundle }) {
  const { t, lang } = useI18n();
  const q = data.quote;
  const pos =
    q.yearLow !== undefined && q.yearHigh !== undefined && q.yearHigh > q.yearLow
      ? Math.min(100, Math.max(0, ((q.price - q.yearLow) / (q.yearHigh - q.yearLow)) * 100))
      : null;
  const rows: [string, string][] = [
    [t.stock.open, fmtPrice(q.open, lang)],
    [t.stock.prevClose, fmtPrice(q.previousClose, lang)],
    [t.stock.dayRange, q.dayLow !== undefined ? `${fmtPrice(q.dayLow, lang)} – ${fmtPrice(q.dayHigh, lang)}` : "—"],
    [t.stock.marketCap, q.marketCap !== undefined ? `$${fmtBig(q.marketCap, lang)}` : "—"],
    [t.stock.volume, fmtBig(q.volume, lang)],
  ];
  return (
    <Panel title={t.stock.keyStats}>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="num text-right">{v}</dd>
          </div>
        ))}
      </dl>
      {pos !== null && (
        <div className="mt-4">
          <p className="text-xs text-muted mb-1.5">{t.stock.yearRange}</p>
          <div className="relative h-2 rounded-full bg-gradient-to-r from-down via-warn to-up" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pos)} aria-label={t.stock.positionIn52w}>
            <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-4 w-4 rounded-full bg-fg border-2 border-panel" style={{ left: `${pos}%` }} />
          </div>
          <div className="flex justify-between num text-xs text-muted mt-1">
            <span>{fmtPrice(q.yearLow, lang)}</span>
            <span>{fmtPrice(q.yearHigh, lang)}</span>
          </div>
        </div>
      )}
    </Panel>
  );
}
