"use client";

import { fill, useI18n } from "@/lib/i18n";
import TradingViewWidget, { tvSymbol, useResolvedTheme } from "./TradingViewWidget";
import { Panel } from "./ui";

export { OfficialReleases } from "./OfficialReleases";
import { OfficialReleases } from "./OfficialReleases";

export default function NewsPanel({ symbol, exchange, onSeeAllFilings }: { symbol: string; exchange?: string; onSeeAllFilings: () => void }) {
  const { t, lang } = useI18n();
  const theme = useResolvedTheme();
  const tv = tvSymbol(symbol, exchange);
  return (
    <div className="space-y-4">
      <Panel title={t.news.secTitle}>
        <p className="text-xs text-muted mb-2">{t.news.secIntro}</p>
        <OfficialReleases symbol={symbol} limit={12} onSeeAll={onSeeAllFilings} />
      </Panel>
      <Panel title={fill(t.news.tvTitle, { s: symbol })}>
        <p className="text-xs text-muted mb-2">{t.news.tvIntro}</p>
        <TradingViewWidget
          widget="timeline"
          height={620}
          title={fill(t.news.tvTitle, { s: symbol })}
          attribution={fill(t.news.tvAttribution, { s: symbol })}
          attributionHref={`https://www.tradingview.com/symbols/${tv.replace(":", "-")}/news/`}
          config={{
            feedMode: "symbol",
            symbol: tv,
            colorTheme: theme,
            isTransparent: true,
            displayMode: "regular",
            width: "100%",
            height: "100%",
            locale: lang,
          }}
        />
      </Panel>
    </div>
  );
}
