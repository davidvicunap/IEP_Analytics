"use client";

// What each kind of window shows. TradingView's embeds for market data (their attribution is
// required and shown); the app's own panels, which already carry their source and time, for the
// company; and the user's plan and notes. Heavy panels load only when a window first needs them.
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtDate, fmtNum, fmtPrice } from "@/lib/format";
import { MAX_NOTE, type Interval, type ValuationView, type Widget, type WidgetKind } from "@/lib/canvas";
import { useNotes, useTheses } from "@/lib/researchClient";
import { useQuotes } from "@/lib/useQuotes";
import TradingViewWidget, { tvSymbol, useResolvedTheme } from "../TradingViewWidget";
import { Badge, IssueNote, Provenance, Skeleton } from "../ui";

const Loading = () => (
  <div className="space-y-3" aria-hidden="true">
    <Skeleton className="h-5 w-1/3" />
    <Skeleton className="h-40 w-full" />
    <Skeleton className="h-4 w-2/3" />
  </div>
);
const AtAGlance = dynamic(() => import("../AtAGlance"), { loading: Loading });
const FinancialStatements = dynamic(() => import("../FinancialStatements"), { loading: Loading });
const RatiosPanel = dynamic(() => import("../RatiosPanel"), { loading: Loading });
const QuarterCard = dynamic(() => import("../QuarterCard"), { loading: Loading });
const FilingsPanel = dynamic(() => import("../FilingsPanel"), { loading: Loading });
const InsidersPanel = dynamic(() => import("../InsidersPanel"), { loading: Loading });
const ValuationPanel = dynamic(() => import("../ValuationPanel"), { loading: Loading });

/** TradingView's technical-analysis widget names its intervals differently from the chart. */
const TV_TECH: Record<Interval, string> = { "5": "5m", "15": "15m", "60": "1h", "240": "4h", D: "1D", W: "1W", M: "1M" };

/** Windows that fill edge to edge (embeds) rather than scrolling a padded panel. */
export const EDGE_TO_EDGE: WidgetKind[] = ["chart", "technicals", "news"];

export default function WidgetBody({
  widget: w,
  onView,
  onText,
  onOpen,
}: {
  widget: Widget;
  onView: (v: ValuationView) => void;
  onText: (text: string) => void;
  /** Opens a related window next to this one (from "At a glance"). */
  onOpen: (kind: WidgetKind) => void;
}) {
  const { t, lang } = useI18n();
  const theme = useResolvedTheme();
  const s = w.symbol ?? "";
  const tv = tvSymbol(s);
  switch (w.kind) {
    case "chart":
      return (
        <TradingViewWidget
          fill
          widget="advanced-chart"
          heightClass=""
          title={fill(t.chart.tvTitle, { s })}
          attribution={fill(t.chart.tvAttribution, { s })}
          attributionHref={`https://www.tradingview.com/symbols/${tv.replace(":", "-")}/`}
          config={{
            autosize: true,
            symbol: tv,
            interval: w.interval ?? "D",
            timezone: "America/New_York",
            theme,
            style: "1",
            locale: lang,
            allow_symbol_change: false,
            withdateranges: true,
            hide_side_toolbar: false,
            details: false,
            hotlist: false,
            calendar: false,
            save_image: true,
            support_host: "https://www.tradingview.com",
          }}
        />
      );
    case "technicals":
      return (
        <TradingViewWidget
          fill
          widget="technical-analysis"
          heightClass=""
          title={fill(t.canvas.tvTechTitle, { s })}
          attribution={fill(t.canvas.tvTechAttribution, { s })}
          attributionHref={`https://www.tradingview.com/symbols/${tv.replace(":", "-")}/technicals/`}
          config={{ interval: TV_TECH[w.interval ?? "D"], width: "100%", height: "100%", isTransparent: true, symbol: tv, showIntervalTabs: true, displayMode: "single", locale: lang, colorTheme: theme }}
        />
      );
    case "news":
      return (
        <TradingViewWidget
          fill
          widget="timeline"
          heightClass=""
          title={fill(t.news.tvTitle, { s })}
          attribution={fill(t.news.tvAttribution, { s })}
          attributionHref={`https://www.tradingview.com/symbols/${tv.replace(":", "-")}/news/`}
          config={{ feedMode: "symbol", symbol: tv, colorTheme: theme, isTransparent: true, displayMode: "regular", width: "100%", height: "100%", locale: lang }}
        />
      );
    case "glance":
      return <AtAGlance symbol={s} onOpen={(tab) => onOpen(tab === "valuation" ? "valuation" : "financials")} />;
    case "financials":
      return <FinancialStatements symbol={s} />;
    case "ratios":
      return <RatiosPanel symbol={s} />;
    case "quarter":
      return <QuarterCard symbol={s} />;
    case "filings":
      return <FilingsPanel symbol={s} />;
    case "insiders":
      return <InsidersPanel symbol={s} />;
    case "valuation":
      return <ValuationBody symbol={s} view={w.view ?? "history"} onView={onView} />;
    case "plan":
      return <PlanCard symbol={s} />;
    case "note":
      return <NoteBody text={w.text ?? ""} onText={onText} />;
  }
}

function ValuationBody({ symbol, view, onView }: { symbol: string; view: ValuationView; onView: (v: ValuationView) => void }) {
  const q = useQuotes([symbol]);
  const price = q.items[0]?.quote?.price ?? null;
  return <ValuationPanel symbol={symbol} price={price} view={view} onView={onView} />;
}

/** Your notebook for this company, read-only: thesis, levels against today's price, status. */
function PlanCard({ symbol }: { symbol: string }) {
  const { t, lang } = useI18n();
  const C = t.canvas;
  const notes = useNotes();
  const theses = useTheses();
  const q = useQuotes([symbol]);
  const item = q.items[0];
  const price = item?.quote?.price ?? null;
  if (notes.state.status === "error") return <IssueNote issue={notes.state.issue} onRetry={notes.retry} />;
  const list = notes.state.status === "ok" ? notes.state.data : notes.state.status === "loading" ? (notes.state.previous?.data ?? null) : null;
  if (!list) return <Loading />;
  const note = list.find((n) => n.symbol === symbol);
  const href = `/stock/${encodeURIComponent(symbol)}?tab=research`;
  const empty = !note || (!note.thesis.trim() && note.fairValue === null && note.entry === null && note.stop === null && note.target === null);
  if (empty) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">{fill(C.planNone, { s: symbol })}</p>
        <Link href={`${href}&plan=1`} prefetch={false} className="link inline-flex min-h-11 items-center text-sm font-medium sm:min-h-0">
          {C.planWrite}
        </Link>
      </div>
    );
  }
  const status = theses.state.status === "ok" ? (theses.state.data.items.find((i) => i.symbol === symbol)?.status ?? null) : null;
  const tone = status === "atRisk" ? "bad" : status === "review" ? "warn" : status === "onTrack" ? "good" : "neutral";
  const levels: [string, number | null][] = [
    [C.planFair, note.fairValue],
    [C.planEntry, note.entry],
    [C.planStop, note.stop],
    [C.planTarget, note.target],
  ];
  const gap = (v: number) => (price ? `${v >= price ? "+" : "−"}${fmtNum((Math.abs(v - price) / price) * 100, lang, 1)}%` : null);
  return (
    <div className="space-y-4">
      {status && <Badge tone={tone}>{t.thesis.status[status]}</Badge>}
      {note.thesis.trim() && <p className="max-w-[68ch] text-[15px] leading-relaxed">{note.thesis}</p>}
      <dl className="num grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        {levels.map(([label, v]) => (
          <div key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="font-medium">
              {v === null ? "—" : fmtPrice(v, lang)}
              {v !== null && gap(v) && <span className="ml-1.5 text-xs font-normal text-muted">{fill(C.planDistance, { p: gap(v)! })}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {note.reviewBy && (
        <p className="num text-xs text-muted">
          {C.planReview} {fmtDate(note.reviewBy, lang)}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={href} prefetch={false} className="link inline-flex min-h-11 items-center text-sm font-medium sm:min-h-0">
          {C.planEdit}
        </Link>
        {q.source && item?.quote && <Provenance source={q.source} asOf={item.fetchedAt ?? undefined} stale={item.stale} />}
      </div>
    </div>
  );
}

/** Free text, saved a moment after you stop typing. */
function NoteBody({ text, onText }: { text: string; onText: (text: string) => void }) {
  const { t } = useI18n();
  const C = t.canvas;
  const [value, setValue] = useState(text);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(onText);
  latest.current = onText;
  // A change from elsewhere (another tab, the account) shows up unless you're typing.
  useEffect(() => {
    if (!timer.current) setValue(text);
  }, [text]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const change = (v: string) => {
    setValue(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      latest.current(v);
    }, 400);
  };
  return (
    <div className="flex h-full flex-col gap-1.5">
      <textarea
        aria-label={C.noteLabel}
        value={value}
        maxLength={MAX_NOTE}
        onChange={(e) => change(e.target.value)}
        onBlur={() => {
          if (timer.current) {
            clearTimeout(timer.current);
            timer.current = null;
            latest.current(value);
          }
        }}
        placeholder={C.notePlaceholder}
        className="min-h-0 w-full flex-1 resize-none bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-muted"
      />
      <p className="num text-right text-[11px] text-muted">{fill(C.noteLeft, { n: MAX_NOTE - value.length })}</p>
    </div>
  );
}
