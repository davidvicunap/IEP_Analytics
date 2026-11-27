"use client";

// What each kind of window shows. TradingView's embeds for market data (their attribution is
// required and shown); the app's own panels, which already carry their source and time, for the
// company; and the user's plan and notes. Heavy panels load only when a window first needs them.
import dynamic from "next/dynamic";
import { fill, useI18n } from "@/lib/i18n";
import type { Interval, ValuationView, Widget, WidgetKind } from "@/lib/canvas";
import TradingViewWidget, { tvSymbol, useResolvedTheme } from "../TradingViewWidget";
import { widgetStudies } from "@/lib/chartStudies";
import { useChartStudies } from "@/lib/chartStudiesClient";
import { Skeleton } from "../ui";
import { NotesWindow, PlanWindow } from "./NotebookWindows";

const Loading = () => (
  <div className="space-y-3" aria-hidden="true">
    <Skeleton className="h-5 w-1/3" />
    <Skeleton className="h-40 w-full" />
    <Skeleton className="h-4 w-2/3" />
  </div>
);
const HighlightsCard = dynamic(() => import("../HighlightsCard"), { loading: Loading });
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
  const studies = useChartStudies();
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
            studies: widgetStudies(studies),
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
      return <HighlightsCard symbol={s} onOpen={() => onOpen("financials")} />;
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
      return <PlanWindow symbol={s} />;
    case "note":
      return <NotesWindow symbol={w.symbol} draft={w.text ?? ""} onDraft={onText} />;
  }
}

function ValuationBody({ symbol, view, onView }: { symbol: string; view: ValuationView; onView: (v: ValuationView) => void }) {
  return <ValuationPanel symbol={symbol} view={view} onView={onView} />;
}
