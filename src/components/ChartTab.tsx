"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtDate, fmtNum, fmtPrice } from "@/lib/format";
import { keyLevels, type KeyLevels } from "@/lib/levels";
import type { Candle, DataIssue } from "@/lib/types";
import type { ChartLevel } from "./PriceChart";
import TradingViewWidget, { tvSymbol, useResolvedTheme } from "./TradingViewWidget";
import { Explain, IssueNote, Panel, Segmented } from "./ui";
import ChartPlaceholder from "./ChartPlaceholder";
import type { ChartSettings } from "@/lib/chartSettings";

const PriceChart = dynamic(() => import("./PriceChart"), {
  ssr: false,
  loading: () => <ChartPlaceholder />,
});

type Lang = "es" | "en";
const pct = (v: number, lang: Lang) => `${v >= 0 ? "+" : "−"}${fmtNum(Math.abs(v) * 100, lang, 1)}%`;

export default function ChartTab({
  symbol,
  exchange,
  history,
  historyIssue,
  signals,
  chart,
  onChart,
}: {
  symbol: string;
  exchange?: string;
  history: Candle[];
  historyIssue: DataIssue | null;
  signals: React.ReactNode;
  chart: ChartSettings;
  onChart: (s: ChartSettings) => void;
}) {
  const { t, lang } = useI18n();
  const theme = useResolvedTheme();
  const [view, setView] = useState<"tv" | "simple">("tv");
  const [showLevels, setShowLevels] = useState(true);
  const levels = useMemo(() => (history.length ? keyLevels(history) : null), [history]);
  const lines = useMemo<ChartLevel[]>(
    () =>
      levels && showLevels
        ? [...levels.supports.map((z) => ({ price: z.price, kind: "support" as const })), ...levels.resistances.map((z) => ({ price: z.price, kind: "resistance" as const }))]
        : [],
    [levels, showLevels],
  );
  const tv = tvSymbol(symbol, exchange);

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Segmented
            label={t.chart.viewLabel}
            value={view}
            onChange={setView}
            options={[
              { value: "tv", label: t.chart.tradingview },
              { value: "simple", label: t.chart.simple },
            ]}
          />
          {view === "simple" && levels && (
            <label className="ml-auto inline-flex items-center gap-2 text-xs min-h-11 cursor-pointer">
              <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={showLevels} onChange={(e) => setShowLevels(e.target.checked)} />
              {t.chart.levels.showOnChart}
            </label>
          )}
        </div>
        {view === "tv" ? (
          <>
            <TradingViewWidget
              widget="advanced-chart"
              heightClass="h-[min(72vh,720px)] min-h-[420px]"
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
                support_host: "https://www.tradingview.com",
              }}
            />
            <p className="mt-2 text-xs text-muted">{t.chart.tvHelp}</p>
          </>
        ) : historyIssue ? (
          <IssueNote issue={historyIssue} />
        ) : (
          <PriceChart history={history} levels={lines} settings={chart} onSettings={onChart} />
        )}
      </Panel>

      {levels && <LevelsPanel k={levels} lang={lang} />}
      {signals}
    </div>
  );
}

function LevelsPanel({ k, lang }: { k: KeyLevels; lang: Lang }) {
  const { t } = useI18n();
  const L = t.chart.levels;
  return (
    <Panel title={L.title}>
      <p className="text-sm">{L.intro}</p>
      <p className="mt-1 text-xs text-muted">{fill(L.price, { p: fmtPrice(k.close, lang), d: fmtDate(k.date, lang) })}</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section aria-labelledby="levels-res">
          <h3 id="levels-res" className="text-sm font-medium text-down">{L.resistances}</h3>
          {k.resistances.length === 0 ? (
            <p className="mt-1 text-sm text-muted">{L.noResistances}</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {k.resistances.map((z) => (
                <li key={z.price} className="text-sm border-l-2 border-down pl-3">
                  {fill(L.resistance, { p: fmtPrice(z.price, lang), dist: pct(z.distance, lang), n: z.touches, d: fmtDate(z.lastDate, lang) })}
                  <span className="block text-[11px] text-muted">{fill(L.range, { lo: fmtPrice(z.low, lang), hi: fmtPrice(z.high, lang) })}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="levels-sup">
          <h3 id="levels-sup" className="text-sm font-medium text-up">{L.supports}</h3>
          {k.supports.length === 0 ? (
            <p className="mt-1 text-sm text-muted">{L.noSupports}</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {k.supports.map((z) => (
                <li key={z.price} className="text-sm border-l-2 border-up pl-3">
                  {fill(L.support, { p: fmtPrice(z.price, lang), dist: pct(z.distance, lang), n: z.touches, d: fmtDate(z.lastDate, lang) })}
                  <span className="block text-[11px] text-muted">{fill(L.range, { lo: fmtPrice(z.low, lang), hi: fmtPrice(z.high, lang) })}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <h3 className="mt-4 text-sm font-medium">{L.refsTitle}</h3>
      <ul className="mt-2 grid gap-1 sm:grid-cols-2 text-sm">
        {k.references.map((r) => (
          <li key={r.key} className="num">
            {fill(L.refText, { name: L.refs[r.key], p: fmtPrice(r.price, lang), dist: pct(r.distance, lang) })}
          </li>
        ))}
      </ul>
      <Explain>{L.explain}</Explain>
      <p className="mt-2 text-[11px] text-muted">{fill(L.method, { tol: fmtPrice(k.tolerance, lang) })}</p>
    </Panel>
  );
}
