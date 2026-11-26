"use client";

import { fill, useI18n } from "@/lib/i18n";
import { widgetStudies } from "@/lib/chartStudies";
import { useChartStudies } from "@/lib/chartStudiesClient";
import ChartStudiesMenu from "./ChartStudiesMenu";
import TradingViewWidget, { tvSymbol, useResolvedTheme } from "./TradingViewWidget";
import { Panel } from "./ui";

/** The company's price chart: TradingView's, opening with the indicators you saved. */
export default function StockChart({ symbol, exchange }: { symbol: string; exchange?: string }) {
  const { t, lang } = useI18n();
  const theme = useResolvedTheme();
  const studies = useChartStudies();
  const tv = tvSymbol(symbol, exchange);
  return (
    // Phones: edge to edge, so the chart gets the whole width instead of losing it to a card.
    <Panel title={t.chart.priceTitle} action={<ChartStudiesMenu />} className="max-sm:-mx-4 max-sm:rounded-none max-sm:border-x-0 max-sm:px-4">
      <TradingViewWidget
        widget="advanced-chart"
        heightClass="h-[min(64vh,600px)] min-h-[400px]"
        fullscreen={{ enter: t.chart.fullscreen, exit: t.chart.exitFullscreen }}
        title={fill(t.chart.tvTitle, { s: symbol })}
        attribution={fill(t.chart.tvAttribution, { s: symbol })}
        attributionHref={`https://www.tradingview.com/symbols/${tv.replace(":", "-")}/`}
        config={{
          autosize: true,
          symbol: tv,
          interval: "D",
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
      <p className="mt-2 text-xs text-muted">{t.chart.tvHelp}</p>
    </Panel>
  );
}
