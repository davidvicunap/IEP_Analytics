"use client";

import dynamic from "next/dynamic";
import { Component, Suspense, use, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { DeepI18n, fill, useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtBig, fmtDate, fmtNum, fmtPct, fmtPrice } from "@/lib/format";
import {
  RULES,
  missingSummaryMetrics,
  scoreFundamentals,
  summarize,
  technicalSignals,
  type MetricKey,
  type MetricScore,
  type SummaryPoint,
} from "@/lib/scoring";
import { parseChartSettings, writeChartSettings, type ChartSettings } from "@/lib/chartSettings";
import ChartPlaceholder from "./ChartPlaceholder";
import type { StockSections } from "@/lib/data";
import type { AnnualIncome, Candle, DataSource, Fundamentals, Profile, Quote, Result } from "@/lib/types";
import { useRecent } from "@/lib/watchlist";
import { OfficialReleases } from "./OfficialReleases";

// Tabs other than the overview load their code on first visit (then stay mounted).
const tabLoading = () => <Skeleton className="h-96" />;
const ChartTab = dynamic(() => import("./ChartTab"), { loading: tabLoading });
const FundamentalsPanel = dynamic(() => import("./fundamentals/FundamentalsPanel"), { loading: tabLoading });
const ValuationPanel = dynamic(() => import("./ValuationPanel"), { loading: tabLoading });
const FinancialStatements = dynamic(() => import("./FinancialStatements"), { loading: tabLoading });
const FilingsPanel = dynamic(() => import("./FilingsPanel"), { loading: tabLoading });
const InsidersPanel = dynamic(() => import("./InsidersPanel"), { loading: tabLoading });
const NewsPanel = dynamic(() => import("./NewsPanel"), { loading: tabLoading });
import Link from "next/link";
import { ChartIcon, ExternalIcon, InfoIcon } from "./icons";
import { Badge, Change, Dot, Explain, IssueNote, LevelBadge, Panel, Provenance, Skeleton, StatusMessage, WatchButton, buttonClass } from "./ui";

const PriceChart = dynamic(() => import("./PriceChart"), {
  ssr: false,
  loading: () => <ChartPlaceholder />,
});

type Tab = "overview" | "chart" | "fundamentals" | "valuation" | "financials" | "filings" | "insiders" | "news";
const TABS: Tab[] = ["overview", "chart", "fundamentals", "valuation", "financials", "filings", "insiders", "news"];

// ---- URL state -------------------------------------------------------------------------
// The tab is a history entry (Back returns to the previous tab); chart settings replace the
// current entry (no history spam) but stay in the URL, so a link reproduces the view.
function useStockUrlState() {
  const params = useSearchParams();
  const pathname = usePathname();
  const raw = params.get("tab") as Tab | null;
  const tab: Tab = raw && TABS.includes(raw) ? raw : "overview";
  const chart = useMemo(() => parseChartSettings(new URLSearchParams(params.toString())), [params]);
  const go = (p: URLSearchParams, push: boolean) => {
    const qs = p.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    if (push) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  };
  const setTab = (next: Tab) => {
    if (next === tab) return;
    const p = new URLSearchParams(window.location.search);
    if (next === "overview") p.delete("tab");
    else p.set("tab", next);
    go(p, true);
  };
  const setChart = (s: ChartSettings) => go(writeChartSettings(new URLSearchParams(window.location.search), s), false);
  return { tab, setTab, chart, setChart };
}

/** A failed section shows a message; the rest of the page keeps working. */
class SectionBoundary extends Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error(JSON.stringify({ event: "section_error", message: error instanceof Error ? error.message : String(error) }));
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Section({ fallback, children }: { fallback: React.ReactNode; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <SectionBoundary fallback={<StatusMessage tone="error">{t.errors.section}</StatusMessage>}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </SectionBoundary>
  );
}

// ---- Page --------------------------------------------------------------------------------

export default function StockView({ quote, quoteFetchedAt, sections }: { quote: Quote; quoteFetchedAt: string; sections: StockSections }) {
  const { t } = useI18n();
  const { tab, setTab, chart, setChart } = useStockUrlState();
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set([tab]));
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const { record } = useRecent();

  useEffect(() => record(quote.symbol), [quote.symbol, record]);
  useEffect(() => setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab))), [tab]);

  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    let n: number | null = null;
    if (e.key === "ArrowRight") n = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = TABS.length - 1;
    if (n === null) return;
    e.preventDefault();
    setTab(TABS[n]);
    tabRefs.current[n]?.focus();
  };

  const panel = (k: Tab, node: React.ReactNode) =>
    visited.has(k) || tab === k ? (
      <div key={k} role="tabpanel" id={`panel-${k}`} aria-labelledby={`tab-${k}`} hidden={tab !== k} tabIndex={0} className="outline-none">
        {node}
      </div>
    ) : null;

  return (
    <div className="space-y-4">
      <StockHeader quote={quote} quoteFetchedAt={quoteFetchedAt} source={sections.source} profile={sections.profile} />

      <div
        role="tablist"
        aria-label={fill(t.ux.sectionsOf, { s: quote.symbol })}
        className="-mx-4 px-4 sm:mx-0 sm:px-0 flex gap-1 overflow-x-auto border-b border-line scrollbar-none"
      >
        {TABS.map((k, i) => (
          <button
            key={k}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${k}`}
            aria-selected={tab === k}
            aria-controls={`panel-${k}`}
            tabIndex={tab === k ? 0 : -1}
            onClick={() => setTab(k)}
            onKeyDown={(e) => onTabKey(e, i)}
            className={`shrink-0 h-11 px-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === k ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg"
            }`}
          >
            {t.stock.tabs[k]}
          </button>
        ))}
      </div>

      {panel("overview", <Overview quote={quote} sections={sections} chart={chart} setChart={setChart} goTo={setTab} />)}
      {panel(
        "chart",
        <Section fallback={<Panel><ChartPlaceholder settings={chart} /></Panel>}>
          <ChartTabSection symbol={quote.symbol} exchange={quote.exchange} history={sections.history} chart={chart} setChart={setChart} />
        </Section>,
      )}
      {panel("fundamentals", <Deep><FundamentalsPanel symbol={quote.symbol} price={quote.price} /></Deep>)}
      {panel("valuation", <Deep><ValuationPanel symbol={quote.symbol} /></Deep>)}
      {panel(
        "financials",
        <Section fallback={<Skeleton className="h-96" />}>
          <DeepI18n>
            <FinancialsSection symbol={quote.symbol} source={sections.source} income={sections.income} />
          </DeepI18n>
        </Section>,
      )}
      {panel("filings", <FilingsPanel symbol={quote.symbol} />)}
      {panel("insiders", <Deep><InsidersPanel symbol={quote.symbol} /></Deep>)}
      {panel("news", <NewsPanel symbol={quote.symbol} exchange={quote.exchange} onSeeAllFilings={() => setTab("filings")} />)}
    </div>
  );
}

/** A tab whose text lives in the deep dictionary: waits for it like for its code. */
function Deep({ children }: { children: React.ReactNode }) {
  return (
    <Section fallback={<Skeleton className="h-96" />}>
      <DeepI18n>{children}</DeepI18n>
    </Section>
  );
}

// ---- Header ------------------------------------------------------------------------------

function StockHeader({ quote, quoteFetchedAt, source, profile }: { quote: Quote; quoteFetchedAt: string; source: DataSource; profile: Promise<Result<Profile>> }) {
  const { t, lang } = useI18n();
  return (
    <section aria-labelledby="stock-title" className="pt-1">
      <div className="flex items-start gap-3">
        <Suspense fallback={<Initial symbol={quote.symbol} />}>
          <Logo profile={profile} symbol={quote.symbol} />
        </Suspense>
        <div className="min-w-0 flex-1">
          <h1 id="stock-title" className="text-xl sm:text-2xl font-semibold tracking-[-0.015em] leading-tight line-clamp-2 break-words">
            {quote.name}
          </h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
            <span className="font-medium text-fg">{quote.symbol}</span>
            {quote.exchange && <span>{quote.exchange}</span>}
            <Suspense fallback={null}>
              <Sector profile={profile} />
            </Suspense>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/charts?s=${encodeURIComponent(quote.symbol)}&m=revenue&f=annual&k=bar&r=10`}
            className={buttonClass("secondary", true, "!px-2.5 sm:!px-3")}
            title={t.stock.compareTitle}
            aria-label={t.stock.compareTitle}
          >
            <ChartIcon size={16} />
            <span className="hidden sm:inline">{t.stock.compare}</span>
          </Link>
          <WatchButton symbol={quote.symbol} />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-1">
        <p className="num text-3xl sm:text-4xl font-semibold leading-none">{fmtPrice(quote.price, lang)}</p>
        <p className="flex items-center gap-2 pb-0.5">
          <Change value={quote.change} pct={quote.changePercent} className="text-base font-semibold" />
          <span className="text-xs text-muted">{t.ux.vsPrevClose}</span>
        </p>
      </div>
      <Provenance source={source} asOf={quote.asOf ?? quoteFetchedAt} className="mt-2" />
    </section>
  );
}

function Initial({ symbol }: { symbol: string }) {
  return (
    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-panel-2 text-lg font-semibold text-muted" aria-hidden="true">
      {symbol[0]}
    </span>
  );
}

function Logo({ profile, symbol }: { profile: Promise<Result<Profile>>; symbol: string }) {
  const p = use(profile);
  const [broken, setBroken] = useState(false);
  const src = p.ok ? p.data.image : undefined;
  if (!src || broken) return <Initial symbol={symbol} />;
  return (
    // Logos come from the data provider's CDN; a plain lazy <img> with fixed size avoids an
    // open image proxy and any layout shift. A broken logo falls back to the empty tile.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={48} height={48} loading="lazy" decoding="async" onError={() => setBroken(true)} className="h-12 w-12 shrink-0 rounded-lg bg-white object-contain p-1 border border-line" />
  );
}

function Sector({ profile }: { profile: Promise<Result<Profile>> }) {
  const p = use(profile);
  return p.ok && p.data.sector ? <span>{p.data.sector}</span> : null;
}

// ---- Overview ------------------------------------------------------------------------------

function Overview({
  quote,
  sections,
  chart,
  setChart,
  goTo,
}: {
  quote: Quote;
  sections: StockSections;
  chart: ChartSettings;
  setChart: (s: ChartSettings) => void;
  goTo: (t: Tab) => void;
}) {
  const { t } = useI18n();
  return (
    // Phones: summary → chart → key data → metrics → signals → company → filings.
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-3 lg:items-start">
      <div className="max-lg:contents lg:col-span-2 lg:space-y-4 min-w-0">
        <Panel className="order-2 min-w-0" title={t.stock.tabs.chart}>
          <Section fallback={<ChartPlaceholder settings={chart} />}>
            <OverviewChart history={sections.history} chart={chart} setChart={setChart} />
          </Section>
        </Panel>
        <div className="order-4">
          <Section fallback={<Skeleton className="h-64" />}>
            <KeyMetrics sections={sections} />
          </Section>
        </div>
        <div className="order-5">
          <Section fallback={<Skeleton className="h-40" />}>
            <Signals history={sections.history} />
          </Section>
        </div>
      </div>
      <div className="max-lg:contents lg:space-y-4 min-w-0">
        <div className="order-1">
          <Section fallback={<SummarySkeleton />}>
            <Summary sections={sections} goTo={goTo} />
          </Section>
        </div>
        <div className="order-3">
          <KeyStats quote={quote} />
        </div>
        <div className="order-6">
          <Section fallback={<Skeleton className="h-32" />}>
            <About profile={sections.profile} />
          </Section>
        </div>
        <Panel title={t.news.latest} className="order-7">
          <OfficialReleases symbol={quote.symbol} limit={4} onSeeAll={() => goTo("filings")} />
        </Panel>
      </div>
    </div>
  );
}

function OverviewChart({ history, chart, setChart }: { history: Promise<Result<Candle[]>>; chart: ChartSettings; setChart: (s: ChartSettings) => void }) {
  const h = use(history);
  if (!h.ok) return <IssueNote issue={h.error} />;
  if (h.data.length === 0) return <IssueNote issue="not_found" />;
  return <PriceChart history={h.data} settings={chart} onSettings={setChart} />;
}

function ChartTabSection({
  symbol,
  exchange,
  history,
  chart,
  setChart,
}: {
  symbol: string;
  exchange?: string;
  history: Promise<Result<Candle[]>>;
  chart: ChartSettings;
  setChart: (s: ChartSettings) => void;
}) {
  const h = use(history);
  const candles = h.ok ? h.data : [];
  return (
    <ChartTab
      symbol={symbol}
      exchange={exchange}
      history={candles}
      historyIssue={h.ok ? (candles.length ? null : "not_found") : h.error}
      chart={chart}
      onChart={setChart}
      signals={<SignalsPanel history={candles} />}
    />
  );
}

function FinancialsSection({ symbol, source, income }: { symbol: string; source: DataSource; income: Promise<Result<AnnualIncome[]>> }) {
  const r = use(income);
  return <FinancialStatements symbol={symbol} fmpIncome={source === "FMP" ? r : undefined} />;
}

// ---- Summary: every sentence with the number behind it -----------------------------------

/** Sized like a typical five-point summary, so the chart below doesn't jump when it lands. */
function SummarySkeleton() {
  return (
    <Panel>
      <Skeleton className="h-3 w-32 mb-4" />
      <div className="space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-5" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-6 w-20" />
          </div>
        ))}
      </div>
      <Skeleton className="h-8 mt-4" />
    </Panel>
  );
}

const METRIC_FORMAT = (k: MetricKey, v: number, lang: "es" | "en") =>
  RULES[k].format === "pct" ? `${fmtNum(v * 100, lang, 1)}%` : `${fmtNum(v, lang, 1)}x`;

/** "≤ 15x good · > 30x careful": the fixed rule of thumb behind a label. */
function ruleText(k: MetricKey, t: ReturnType<typeof useI18n>["t"], lang: "es" | "en") {
  const r = RULES[k];
  const f = (v: number) => METRIC_FORMAT(k, v, lang);
  if (k === "dividendYield") return t.insights.ruleDividend;
  return fill(r.dir === "low" ? t.insights.ruleLow : t.insights.ruleHigh, { good: f(r.good), bad: f(r.bad) });
}

function Summary({ sections, goTo }: { sections: StockSections; goTo: (t: Tab) => void }) {
  const { t, lang } = useI18n();
  const f = use(sections.fundamentals);
  const inc = use(sections.income);
  const h = use(sections.history);
  const income = inc.ok ? inc.data : [];
  const scores = f.ok ? scoreFundamentals(f.data, income) : [];
  const signals = h.ok ? technicalSignals(h.data) : [];
  const points = summarize(scores, signals);
  const missing = f.ok ? missingSummaryMetrics(scores) : [];
  const lastTwo = income.slice(-2);

  const period = (p: SummaryPoint): string => {
    if (p.metric === "revenueGrowth" && lastTwo.length === 2) return fill(t.insights.periodYears, { a: lastTwo[0].year, b: lastTwo[1].year });
    if (p.metric) return t.insights.periodTtm;
    if (p.trend && h.ok) return fill(t.insights.periodClose, { d: fmtDate(h.data[h.data.length - 1].time, lang) });
    return "";
  };
  const asOf = (p: SummaryPoint) => (p.metric === "revenueGrowth" ? inc : p.metric ? f : h);

  return (
    <Panel title={t.stock.summaryTitle} id="summary">
      {points.length === 0 && (
        <StatusMessage>{!f.ok ? t.data.issues[f.error] : t.insights.noneYet}</StatusMessage>
      )}
      <ul className="space-y-3">
        {points.map((p) => {
          const src = asOf(p);
          return (
            <li key={p.key} className="flex gap-2.5">
              <Dot level={p.level} />
              <div className="min-w-0 flex-1">
                <p className="text-sm">{t.summary[p.key]}</p>
                <p className="mt-0.5 text-xs text-muted leading-relaxed">
                  {p.metric && p.value !== undefined && (
                    <span className="num font-semibold text-fg">
                      {t.metrics[p.metric].short} {METRIC_FORMAT(p.metric, p.value, lang)}
                    </span>
                  )}
                  {p.trend && (
                    <span className="num font-semibold text-fg">
                      {fill(t.insights.trendEvidence, { c: fmtPrice(p.trend.close, lang), s: fmtPrice(p.trend.sma200, lang) })}
                    </span>
                  )}
                  {" · "}
                  {period(p)}
                  {src.ok && ` · ${fill(t.insights.sourceAt, { s: sections.source === "DEMO" ? t.insights.demoShort : "FMP", d: fmtAsOf(src.fetchedAt, lang) })}`}
                </p>
                <Explain label={t.insights.why} className="mt-0">
                  <p>
                    <LevelBadge level={p.level} />{" "}
                    {p.metric ? ruleText(p.metric, t, lang) : t.insights.ruleTrend}
                  </p>
                  <p className="mt-1 text-xs">{p.metric ? t.metrics[p.metric].what : t.chart.sma.text}</p>
                </Explain>
              </div>
            </li>
          );
        })}
      </ul>
      {missing.length > 0 && (
        <p className="mt-4 flex gap-2 rounded-lg bg-panel-2 px-3 py-2 text-xs text-muted">
          <InfoIcon size={16} className="mt-px" />
          <span>{fill(t.insights.missing, { list: missing.map((k) => t.metrics[k].short).join(", ") })}</span>
        </p>
      )}
      <p className="mt-4 text-xs text-muted leading-relaxed">
        {t.insights.heuristicNote}{" "}
        <button type="button" className="link inline-flex items-center min-h-11 sm:min-h-6 text-left" onClick={() => goTo("fundamentals")}>
          {t.insights.seeSector}
        </button>
      </p>
    </Panel>
  );
}

// ---- Grouped metrics -------------------------------------------------------------------

const GROUPS: { key: "valuation" | "growth" | "profitability" | "health" | "dividends"; metrics: MetricKey[] }[] = [
  { key: "valuation", metrics: ["pe", "ps", "pb"] },
  { key: "growth", metrics: ["revenueGrowth"] },
  { key: "profitability", metrics: ["netMargin", "grossMargin", "roe"] },
  { key: "health", metrics: ["debtToEquity", "currentRatio"] },
  { key: "dividends", metrics: ["dividendYield"] },
];

function KeyMetrics({ sections }: { sections: StockSections }) {
  const { t, lang } = useI18n();
  const f = use(sections.fundamentals);
  const inc = use(sections.income);
  if (!f.ok) {
    return (
      <Panel title={t.insights.metricsTitle}>
        <IssueNote issue={f.error} />
      </Panel>
    );
  }
  const scores = scoreFundamentals(f.data as Fundamentals, inc.ok ? inc.data : []);
  const by = new Map<MetricKey, MetricScore>(scores.map((s) => [s.key, s]));
  return (
    <Panel title={t.insights.metricsTitle} id="metrics">
      <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
        {GROUPS.map((g) => (
          <div key={g.key} className="min-w-0">
            <h3 className="control-label mb-1">{t.insights.groups[g.key]}</h3>
            <ul className="divide-y divide-line border-y border-line">
              {g.metrics.map((k) => {
                const s = by.get(k);
                return (
                  <li key={k}>
                    <details className="group">
                      <summary className="flex items-center gap-2 min-h-11 cursor-pointer hover:bg-panel-2/60 -mx-2 px-2 rounded-md">
                        <span className="flex-1 min-w-0 text-sm">{t.metrics[k].name}</span>
                        {s ? (
                          <>
                            <span className="num text-sm font-semibold">{METRIC_FORMAT(k, s.value!, lang)}</span>
                            <LevelBadge level={s.level} />
                          </>
                        ) : (
                          <Badge>{t.insights.noData}</Badge>
                        )}
                      </summary>
                      <div className="pb-3 text-xs text-muted leading-relaxed space-y-1">
                        <p>{t.metrics[k].what}</p>
                        {s && <p>{ruleText(k, t, lang)}</p>}
                        {!s && <p>{t.insights.noDataText}</p>}
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <Provenance source={sections.source} asOf={f.fetchedAt} className="mt-4" />
      <p className="mt-1 text-xs text-muted">{t.insights.ttmNote}</p>
    </Panel>
  );
}

// ---- Signals, key stats, company --------------------------------------------------------

function Signals({ history }: { history: Promise<Result<Candle[]>> }) {
  const h = use(history);
  return h.ok ? <SignalsPanel history={h.data} /> : null;
}

function SignalsPanel({ history }: { history: Candle[] }) {
  const { t, lang } = useI18n();
  const signals = useMemo(() => technicalSignals(history), [history]);
  if (signals.length === 0) return null;
  const ago = (days?: number) => (days === undefined ? "" : days === 0 ? t.ago.today : days === 1 ? t.ago.one : fill(t.ago.many, { n: days }));
  const last = history[history.length - 1];
  return (
    <Panel title={t.stock.signalsTitle}>
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
      {last && <p className="mt-3 text-xs text-muted">{fill(t.insights.signalsBasis, { d: fmtDate(last.time, lang) })}</p>}
    </Panel>
  );
}

function KeyStats({ quote: q }: { quote: Quote }) {
  const { t, lang } = useI18n();
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
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-sm">
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
          <div
            className="relative h-1.5 rounded-full bg-line"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pos)}
            aria-valuetext={fill(t.ux.rangePos, { p: fmtPct(pos, lang).replace(/\.00%$/, "%"), lo: fmtPrice(q.yearLow, lang), hi: fmtPrice(q.yearHigh, lang) })}
            aria-label={t.stock.positionIn52w}
          >
            <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3.5 w-3.5 rounded-full bg-fg border-2 border-panel" style={{ left: `${pos}%` }} />
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

function About({ profile }: { profile: Promise<Result<Profile>> }) {
  const { t, lang } = useI18n();
  const p = use(profile);
  if (!p.ok) {
    return (
      <Panel title={t.stock.about}>
        <IssueNote issue={p.error} />
      </Panel>
    );
  }
  const d = p.data;
  return (
    <Panel title={t.stock.about}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {d.industry && (<><dt className="text-muted">{t.stock.industry}</dt><dd>{d.industry}</dd></>)}
        {d.ceo && (<><dt className="text-muted">{t.stock.ceo}</dt><dd>{d.ceo}</dd></>)}
        {d.employees !== undefined && (<><dt className="text-muted">{t.stock.employees}</dt><dd className="num">{fmtNum(d.employees, lang, 0)}</dd></>)}
        {d.website && (
          <>
            <dt className="text-muted">{t.stock.website}</dt>
            <dd className="min-w-0">
              <a className="inline-flex items-center gap-1 link break-all" href={d.website} target="_blank" rel="noopener noreferrer">
                {d.website.replace(/^https?:\/\//, "")}
                <ExternalIcon size={14} />
              </a>
            </dd>
          </>
        )}
      </dl>
      {d.description && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer link text-xs inline-flex items-center min-h-8">{t.ux.readDescription}</summary>
          <p className="mt-2 leading-relaxed text-muted">{d.description}</p>
        </details>
      )}
    </Panel>
  );
}
