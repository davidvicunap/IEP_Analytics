"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Component, Suspense, use, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { DeepI18n, fill, useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtBig, fmtDate, fmtNum, fmtPrice } from "@/lib/format";
import { technicalSignals } from "@/lib/scoring";
import { parseChartSettings, writeChartSettings, type ChartSettings } from "@/lib/chartSettings";
import ChartPlaceholder from "./ChartPlaceholder";
import type { StockIdentity, StockSections } from "@/lib/data";
import type { Candle, DataIssue, DataSource, Profile, Quote, Result } from "@/lib/types";
import { useRecent } from "@/lib/watchlist";
import AtAGlance from "./AtAGlance";
import ExplainPanel from "./ExplainPanel";
import QuarterCard from "./QuarterCard";
import { FairValueLine, ResearchCard } from "./research/FairValue";
import NextEarnings from "./NextEarnings";
import { ClockIcon, ColumnsIcon, ExternalIcon, GridIcon } from "./icons";
import { Change, Dot, IssueNote, Panel, Provenance, Segmented, Skeleton, StatusMessage, WatchButton, buttonClass } from "./ui";

// Tabs other than the overview load their code on first visit (then stay mounted).
const tabLoading = () => <Skeleton className="h-96" />;
const ChartTab = dynamic(() => import("./ChartTab"), { loading: () => <Panel><ChartPlaceholder /></Panel> });
const FundamentalsPanel = dynamic(() => import("./fundamentals/FundamentalsPanel"), { loading: tabLoading });
const ValuationPanel = dynamic(() => import("./ValuationPanel"), { loading: tabLoading });
const FinancialStatements = dynamic(() => import("./FinancialStatements"), { loading: tabLoading });
const FilingsPanel = dynamic(() => import("./FilingsPanel"), { loading: tabLoading });
const InsidersPanel = dynamic(() => import("./InsidersPanel"), { loading: tabLoading });
const NewsPanel = dynamic(() => import("./NewsPanel"), { loading: tabLoading });
const ResearchPanel = dynamic(() => import("./research/ResearchPanel"), { loading: tabLoading });

type Tab = "overview" | "business" | "valuation" | "filings" | "research";
const TABS: Tab[] = ["overview", "business", "valuation", "filings", "research"];
type BusinessView = "summary" | "statements";
type FilingsView = "filings" | "insiders" | "news";
const BUSINESS_VIEWS: BusinessView[] = ["summary", "statements"];
const FILINGS_VIEWS: FilingsView[] = ["filings", "insiders", "news"];
type ValuationView = "comps" | "history" | "dcf" | "expectations";
const VALUATION_VIEWS: ValuationView[] = ["comps", "history", "dcf", "expectations"];

/** Links from before the tabs were merged keep working (bookmarks, shared links, journeys). */
const LEGACY: Record<string, { tab: Tab; view?: string }> = {
  chart: { tab: "overview" },
  fundamentals: { tab: "business" },
  financials: { tab: "business", view: "statements" },
  insiders: { tab: "filings", view: "insiders" },
  news: { tab: "filings", view: "news" },
};

// ---- URL state -------------------------------------------------------------------------
// The tab and its view are history entries (Back returns to the previous one); chart settings
// replace the current entry (no history spam) but stay in the URL, so a link reproduces the view.
function useStockUrlState() {
  const params = useSearchParams();
  const pathname = usePathname();
  const raw = params.get("tab");
  const legacy = raw ? LEGACY[raw] : undefined;
  const tab: Tab = legacy ? legacy.tab : raw && (TABS as string[]).includes(raw) ? (raw as Tab) : "overview";
  const rawView = legacy?.view ?? params.get("view");
  const businessView: BusinessView = (BUSINESS_VIEWS as string[]).includes(rawView ?? "") ? (rawView as BusinessView) : "summary";
  const filingsView: FilingsView = (FILINGS_VIEWS as string[]).includes(rawView ?? "") ? (rawView as FilingsView) : "filings";
  const valuationView: ValuationView = (VALUATION_VIEWS as string[]).includes(rawView ?? "") ? (rawView as ValuationView) : "comps";
  const chart = useMemo(() => parseChartSettings(new URLSearchParams(params.toString())), [params]);

  // Rewrite an old link to its new address once, without a history entry.
  useEffect(() => {
    if (!legacy) return;
    const p = new URLSearchParams(window.location.search);
    if (legacy.tab === "overview") p.delete("tab");
    else p.set("tab", legacy.tab);
    if (legacy.view) p.set("view", legacy.view);
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }, [legacy, pathname]);

  const go = (p: URLSearchParams, push: boolean) => {
    const qs = p.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    if (push) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  };
  const setTab = (next: Tab, view?: string) => {
    if (next === tab && !view) return;
    const p = new URLSearchParams(window.location.search);
    if (next === "overview") p.delete("tab");
    else p.set("tab", next);
    if (view) p.set("view", view);
    else p.delete("view");
    go(p, true);
  };
  const setView = (view: string) => {
    const p = new URLSearchParams(window.location.search);
    p.set("view", view);
    go(p, true);
  };
  const setChart = (s: ChartSettings) => go(writeChartSettings(new URLSearchParams(window.location.search), s), false);
  return { tab, setTab, businessView, filingsView, valuationView, setView, chart, setChart };
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

export default function StockView({
  identity,
  quote,
  quoteFetchedAt,
  priceIssue,
  sections,
}: {
  identity: StockIdentity;
  quote: Quote | null; // null: no price from any source (see getStockPage)
  quoteFetchedAt: string | null;
  priceIssue: DataIssue | null; // why the live quote failed, when it did
  sections: StockSections;
}) {
  const { t } = useI18n();
  const { tab, setTab, businessView, filingsView, valuationView, setView, chart, setChart } = useStockUrlState();
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set([tab]));
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const { record } = useRecent();
  const symbol = identity.symbol;

  useEffect(() => record(symbol), [symbol, record]);
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
    <div className="space-y-5">
      <StockHeader identity={identity} quote={quote} quoteFetchedAt={quoteFetchedAt} priceIssue={priceIssue} source={sections.source} profile={sections.profile} goTo={setTab} />

      <div role="tablist" aria-label={fill(t.ux.sectionsOf, { s: symbol })} className="-mx-4 pl-4 pr-12 sm:mx-0 sm:px-0 flex gap-1 overflow-x-auto border-b border-line scrollbar-none [mask-image:linear-gradient(to_right,black_80%,transparent)] sm:[mask-image:none]">
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
            className={`shrink-0 h-11 px-2.5 sm:px-3 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === k ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg"}`}
          >
            {t.stock.tabs[k]}
          </button>
        ))}
      </div>

      {panel("overview", <Overview identity={identity} quote={quote} sections={sections} chart={chart} setChart={setChart} goTo={setTab} />)}
      {panel(
        "business",
        <div className="space-y-4">
          <SubNav label={t.stock.tabs.business} value={businessView} onChange={setView} options={BUSINESS_VIEWS.map((v) => ({ value: v, label: t.stock.views[v] }))} />
          {businessView === "summary" ? (
            <>
              <Section fallback={<Skeleton className="h-32" />}>
                <About profile={sections.profile} />
              </Section>
              <Deep>
                <FundamentalsPanel symbol={symbol} />
              </Deep>
            </>
          ) : (
            <Deep>
              <FinancialStatements symbol={symbol} />
            </Deep>
          )}
        </div>,
      )}
      {panel("valuation", <Deep><ValuationPanel symbol={symbol} price={quote?.price ?? null} view={valuationView} onView={setView} /></Deep>)}
      {panel(
        "filings",
        <div className="space-y-4">
          <SubNav label={t.stock.tabs.filings} value={filingsView} onChange={setView} options={FILINGS_VIEWS.map((v) => ({ value: v, label: t.stock.views[v] }))} />
          {filingsView === "filings" ? (
            <FilingsPanel symbol={symbol} />
          ) : filingsView === "insiders" ? (
            <Deep>
              <InsidersPanel symbol={symbol} />
            </Deep>
          ) : (
            <NewsPanel symbol={symbol} exchange={identity.exchange} onSeeAllFilings={() => setView("filings")} />
          )}
        </div>,
      )}
      {panel("research", <ResearchPanel symbol={symbol} price={quote?.price ?? null} history={sections.history} />)}
    </div>
  );
}

/** The views inside a tab (Business: summary or statements; Filings: filings, insiders, news). */
function SubNav<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return <Segmented label={label} value={value} onChange={onChange} options={options} />;
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

function StockHeader({
  identity,
  quote,
  quoteFetchedAt,
  priceIssue,
  source,
  profile,
  goTo,
}: {
  identity: StockIdentity;
  quote: Quote | null;
  quoteFetchedAt: string | null;
  priceIssue: DataIssue | null;
  source: DataSource;
  profile: Promise<Result<Profile>>;
  goTo: (t: Tab, view?: string) => void;
}) {
  const { t, lang } = useI18n();
  return (
    <section aria-labelledby="stock-title" className="pt-1">
      {/* Phones: the name gets the full width and the actions drop to their own row. */}
      <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap">
        <Suspense fallback={<Initial symbol={identity.symbol} />}>
          <Logo profile={profile} symbol={identity.symbol} />
        </Suspense>
        <div className="min-w-0 flex-1">
          <h1 id="stock-title" className="text-xl sm:text-2xl font-semibold tracking-[-0.015em] leading-tight line-clamp-2 break-words">
            {identity.name}
          </h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
            <span className="font-medium text-fg">{identity.symbol}</span>
            {identity.exchange && <span>{identity.exchange}</span>}
            <Suspense fallback={null}>
              <Sector profile={profile} />
            </Suspense>
          </p>
        </div>
        <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
          <Link
            href={`/charts/packs?s=${encodeURIComponent(identity.symbol)}`}
            className={buttonClass("secondary", true, "!px-2.5 sm:!px-3")}
            title={t.stock.packsTitle}
            aria-label={t.stock.packsTitle}
          >
            <GridIcon size={16} />
            <span className="hidden min-[360px]:inline">{t.stock.packs}</span>
          </Link>
          <Link
            href={`/compare?s=${encodeURIComponent(identity.symbol)}`}
            className={buttonClass("secondary", true, "!px-2.5 sm:!px-3")}
            title={t.compare.title}
            aria-label={t.compare.title}
          >
            <ColumnsIcon size={16} />
            <span className="hidden min-[360px]:inline">{t.compare.button}</span>
          </Link>
          <WatchButton symbol={identity.symbol} />
        </div>
      </div>
      {quote ? (
        <>
          <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-1">
            <p className="figure text-4xl sm:text-5xl">{fmtPrice(quote.price, lang)}</p>
            <p className="flex items-center gap-2 pb-0.5">
              <Change value={quote.change} pct={quote.changePercent} className="text-base font-semibold" />
              <span className="text-xs text-muted">{t.ux.vsPrevClose}</span>
            </p>
          </div>
          {quote.basis ? (
            // Not live: say which price this is and why, in words, before anything else.
            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted" data-price-basis={quote.basis}>
              <ClockIcon size={14} className="mt-px text-warn" />
              <span>
                {quote.basis === "close"
                  ? fill(t.stock.priceClose, { d: fmtDate(quote.asOf ?? "", lang) })
                  : fill(t.stock.priceStored, { d: fmtAsOf(quoteFetchedAt ?? quote.asOf, lang) })}
                {priceIssue && ` ${t.stock.priceWhy[priceIssue]}`}
              </span>
            </p>
          ) : (
            <Provenance source={source} asOf={quote.asOf ?? quoteFetchedAt ?? undefined} className="mt-2" />
          )}
        </>
      ) : (
        <div className="mt-3 rounded-lg bg-panel-2 px-3 py-2.5 text-sm" data-price-basis="none">
          <p className="font-medium">{t.stock.priceMissing}</p>
          <p className="mt-0.5 text-[13px] text-muted">
            {priceIssue && `${t.stock.priceWhy[priceIssue]} `}
            {t.stock.priceMissingHint}{" "}
            <button type="button" className="link" onClick={() => {
                goTo("overview");
                requestAnimationFrame(() => document.getElementById("price")?.scrollIntoView({ behavior: "smooth", block: "start" }));
              }}>
              {t.stock.openLiveChart}
            </button>
          </p>
        </div>
      )}
      {quote && <KeyFacts quote={quote} />}
      <NextEarnings symbol={identity.symbol} />
      <FairValueLine symbol={identity.symbol} price={quote?.price ?? null} onOpen={() => goTo("research")} />
    </section>
  );
}

function Initial({ symbol }: { symbol: string }) {
  return (
    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-line bg-panel text-base font-semibold tracking-tight text-fg" aria-hidden="true">
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
    <img src={src} alt="" width={48} height={48} loading="lazy" decoding="async" onError={() => setBroken(true)} className="h-12 w-12 shrink-0 rounded-full bg-white object-contain p-1.5 border border-line" />
  );
}

function Sector({ profile }: { profile: Promise<Result<Profile>> }) {
  const p = use(profile);
  return p.ok && p.data.sector ? <span>{p.data.sector}</span> : null;
}

/** One quiet line under the price: size, where it sits in its 52-week range, and today's volume. */
function KeyFacts({ quote: q }: { quote: Quote }) {
  const { t, lang } = useI18n();
  const facts: [string, string][] = [];
  if (q.marketCap !== undefined) facts.push([t.stock.marketCap, `$${fmtBig(q.marketCap, lang)}`]);
  if (q.yearLow !== undefined && q.yearHigh !== undefined) facts.push([t.stock.yearRange, `${fmtPrice(q.yearLow, lang)} – ${fmtPrice(q.yearHigh, lang)}`]);
  if (q.volume !== undefined) facts.push([t.stock.volume, fmtBig(q.volume, lang)]);
  if (!facts.length) return null;
  return (
    <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
      {facts.map(([k, v]) => (
        <div key={k} className="flex gap-1.5">
          <dt className="text-muted">{k}</dt>
          <dd className="num font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---- Overview ------------------------------------------------------------------------------
// One screen: the price, the verdict, the latest quarter and your own thesis. Everything else
// lives one tab away.

function Overview({
  identity,
  quote,
  sections,
  chart,
  setChart,
  goTo,
}: {
  identity: StockIdentity;
  quote: Quote | null;
  sections: StockSections;
  chart: ChartSettings;
  setChart: (s: ChartSettings) => void;
  goTo: (t: Tab, view?: string) => void;
}) {
  return (
    // Phones: verdict → chart → quarter → thesis.
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-3 lg:items-start">
      <div className="max-lg:contents lg:col-span-2 lg:space-y-4 min-w-0">
        <div className="order-2 min-w-0 scroll-mt-20" id="price">
          <Section fallback={<Panel><ChartPlaceholder settings={chart} /></Panel>}>
            <PriceSection symbol={identity.symbol} exchange={identity.exchange} history={sections.history} chart={chart} setChart={setChart} />
          </Section>
        </div>
        <div className="order-3 min-w-0">
          <QuarterCard symbol={identity.symbol} />
          <ExplainPanel symbol={identity.symbol} />
        </div>
      </div>
      <div className="max-lg:contents lg:space-y-4 min-w-0">
        <div className="order-1">
          <AtAGlance symbol={identity.symbol} onOpen={(tab) => goTo(tab)} />
        </div>
        <div className="order-4">
          <ResearchCard symbol={identity.symbol} price={quote?.price ?? null} onOpen={() => goTo("research")} />
        </div>
      </div>
    </div>
  );
}

function PriceSection({
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
      signals={<SignalsList history={candles} />}
    />
  );
}

function SignalsList({ history }: { history: Candle[] }) {
  const { t, lang } = useI18n();
  const signals = useMemo(() => technicalSignals(history), [history]);
  if (signals.length === 0) return null;
  const ago = (days?: number) => (days === undefined ? "" : days === 0 ? t.ago.today : days === 1 ? t.ago.one : fill(t.ago.many, { n: days }));
  const last = history[history.length - 1];
  return (
    <section aria-labelledby="signals-title">
      <h3 id="signals-title" className="text-sm font-semibold">{t.stock.signalsTitle}</h3>
      <ul className="mt-2 space-y-2">
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
      {last && <p className="mt-2 text-xs text-muted">{fill(t.stock.signalsBasis, { d: fmtDate(last.time, lang) })}</p>}
    </section>
  );
}

// ---- Company -----------------------------------------------------------------------------

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
      {d.description && <p className="max-w-[72ch] text-[15px] leading-7 line-clamp-4">{d.description}</p>}
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {d.industry && (
          <div className="flex gap-1.5">
            <dt className="text-muted">{t.stock.industry}</dt>
            <dd>{d.industry}</dd>
          </div>
        )}
        {d.ceo && (
          <div className="flex gap-1.5">
            <dt className="text-muted">{t.stock.ceo}</dt>
            <dd>{d.ceo}</dd>
          </div>
        )}
        {d.employees !== undefined && (
          <div className="flex gap-1.5">
            <dt className="text-muted">{t.stock.employees}</dt>
            <dd className="num">{fmtNum(d.employees, lang, 0)}</dd>
          </div>
        )}
        {d.website && (
          <div className="flex min-w-0 gap-1.5">
            <dt className="text-muted">{t.stock.website}</dt>
            <dd className="min-w-0">
              <a className="inline-flex items-center gap-1 link break-all" href={d.website} target="_blank" rel="noopener noreferrer">
                {d.website.replace(/^https?:\/\//, "")}
                <ExternalIcon size={14} />
              </a>
            </dd>
          </div>
        )}
      </dl>
      {d.description && d.description.length > 400 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer link text-xs inline-flex items-center min-h-11 sm:min-h-8">{t.ux.readDescription}</summary>
          <p className="mt-2 leading-relaxed text-muted">{d.description}</p>
        </details>
      )}
    </Panel>
  );
}
