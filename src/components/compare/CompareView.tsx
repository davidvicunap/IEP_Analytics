"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtBig, fmtNum, fmtPrice } from "@/lib/format";
import { COMPARE_MULTIPLES, COMPARE_RATIOS, MAX_COMPARE, bestIndex, parseCompare } from "@/lib/compare";
import { buildChartData, type PeriodSeries } from "@/lib/chartMetrics";
import { writeConfig } from "@/lib/chartConfig";
import { RATIOS } from "@/lib/ratios";
import type { RatiosPayload } from "@/lib/ratiosData";
import { sharedLoader, type ViewIssue } from "@/lib/resource";
import type { ValuationPayload } from "@/lib/valuationData";
import { VERDICT_KEYS } from "@/lib/verdict";
import type { VerdictPayload } from "@/lib/verdictData";
import { useQuotes } from "@/lib/useQuotes";
import { useWatchlist } from "@/lib/watchlist";
import { markStep } from "@/lib/onboarding";
import { Mark, fmtMetric, verdictEvidence } from "../AtAGlance";
import { SLOTS, formatter, periodLabel, useSymbolData } from "../charts/chartShared";
import TrendChart, { Swatch, useChartColors, type ChartSeries } from "../charts/TrendChart";
import TickerSearch from "../TickerSearch";
import { CloseIcon, ExternalIcon } from "../icons";
import { Change, IssueNote, Panel, Provenance, Skeleton, buttonClass } from "../ui";

type Lang = "es" | "en";
type Load<T> = { status: "loading" } | { status: "ok"; data: T; fetchedAt: string } | { status: "error"; issue: ViewIssue };

/** One shared request per URL; each column loads and fails on its own. */
function useMany<T>(urls: string[]): Record<string, Load<T>> {
  const [state, setState] = useState<Record<string, Load<T>>>({});
  const key = urls.join("|");
  useEffect(() => {
    let alive = true;
    const list = key ? key.split("|") : [];
    setState((prev) => Object.fromEntries(list.map((u) => [u, prev[u]?.status === "ok" ? prev[u] : { status: "loading" }])));
    for (const u of list) {
      sharedLoader.load<T>(u).then((r) => {
        if (!alive) return;
        setState((prev) => ({ ...prev, [u]: r.ok ? { status: "ok", data: r.data, fetchedAt: r.fetchedAt } : { status: "error", issue: r.error } }));
      });
    }
    return () => {
      alive = false;
    };
  }, [key]);
  return state;
}

const enc = encodeURIComponent;

/** Up to four companies side by side; the list is in the URL (?s=AAPL,MSFT), so it can be shared. */
export default function CompareView() {
  const { t } = useI18n();
  const C = t.compare;
  const params = useSearchParams();
  const pathname = usePathname();
  const symbols = parseCompare(params.get("s"));
  const watch = useWatchlist();
  const set = (next: string[]) => window.history.pushState(null, "", next.length ? `${pathname}?s=${next.map(enc).join(",")}` : pathname);
  const suggestion = (watch.list.length >= 2 ? watch.list : ["AAPL", "MSFT", "GOOGL"]).slice(0, 3);
  const comparing = symbols.length >= 2;
  useEffect(() => {
  }, [comparing]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{symbols.length ? `${C.title}: ${symbols.join(" · ")}` : C.title}</h1>
        <p className="mt-1 max-w-2xl text-[15px] text-muted">{C.intro}</p>
      </div>

      <section aria-label={C.add} className="space-y-3 rounded-lg border border-line bg-panel p-4 sm:p-5">
        {symbols.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {symbols.map((s, i) => (
              <li key={s} className="inline-flex h-11 sm:h-9 items-center gap-1.5 rounded-full border border-line bg-panel-2 pl-3 pr-1 text-sm font-semibold">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: `var(${SLOTS[i]})` }} aria-hidden="true" />
                {s}
                <button type="button" onClick={() => set(symbols.filter((x) => x !== s))} className="-mr-1 grid h-11 w-11 sm:mr-0 sm:h-7 sm:w-7 place-items-center rounded-full text-muted hover:bg-panel hover:text-fg" aria-label={fill(C.remove, { s })}>
                  <CloseIcon size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {symbols.length < MAX_COMPARE ? (
          <div className="max-w-md">
            <TickerSearch label={C.add} placeholder={C.addPlaceholder} onSelect={(s) => !symbols.includes(s) && set([...symbols, s])} />
          </div>
        ) : (
          <p className="text-sm text-muted">{fill(C.full, { n: MAX_COMPARE })}</p>
        )}
      </section>

      {symbols.length < 2 ? (
        <div className="rounded-lg border border-line bg-panel px-6 py-12 text-center text-sm text-muted">
          <p>{symbols.length === 0 ? C.empty : C.one}</p>
          {symbols.length === 0 && (
            <p className="mt-3">
              {C.try}{" "}
              <Link href={`/compare?s=${suggestion.map(enc).join(",")}`} className="link" prefetch={false}>
                {suggestion.join(" · ")}
              </Link>
            </p>
          )}
        </div>
      ) : (
        <Tables symbols={symbols} />
      )}
      <p className="text-xs text-muted">{C.disclaimer}</p>
    </div>
  );
}

function Tables({ symbols }: { symbols: string[] }) {
  const { t, lang } = useI18n();
  const C = t.compare;
  const quotes = useQuotes(symbols);
  const verdicts = useMany<VerdictPayload>(symbols.map((s) => `/api/verdict/${enc(s)}`));
  const ratios = useMany<RatiosPayload>(symbols.map((s) => `/api/sec/ratios/${enc(s)}`));
  const vals = useMany<ValuationPayload>(symbols.map((s) => `/api/valuation/${enc(s)}`));
  const v = (s: string) => verdicts[`/api/verdict/${enc(s)}`];
  const r = (s: string) => ratios[`/api/sec/ratios/${enc(s)}`];
  const val = (s: string) => vals[`/api/valuation/${enc(s)}`];
  const quote = (s: string) => quotes.items.find((i) => i.symbol === s)?.quote;
  const quoteAt = quotes.items.map((i) => i.fetchedAt).filter(Boolean).sort().pop();

  return (
    <>
      <Panel title={C.company}>
        <Grid symbols={symbols} label={C.company}>
          <Row label={C.price}>
            {symbols.map((s) => {
              const q = quote(s);
              return (
                <Cell key={s}>
                  {q ? (
                    <>
                      <span className="block font-semibold num">{fmtPrice(q.price, lang)}</span>
                      <Change pct={q.changePercent} className="text-xs" />
                      <span className="mt-0.5 block truncate text-xs text-muted">{q.name}</span>
                    </>
                  ) : quotes.loading ? (
                    <Skeleton className="h-4 w-16" />
                  ) : (
                    <span className="text-muted">{C.noData}</span>
                  )}
                </Cell>
              );
            })}
          </Row>
          <Row label={C.marketCap}>
            {symbols.map((s) => (
              <Cell key={s}>{quote(s)?.marketCap ? <span className="num">${fmtBig(quote(s)!.marketCap!)}</span> : <span className="text-muted">—</span>}</Cell>
            ))}
          </Row>
        </Grid>
        {quoteAt && quotes.source && <Provenance source={quotes.source} asOf={quoteAt} className="mt-3" />}
      </Panel>

      <Panel title={C.glance} description={C.glanceNote}>
        <Grid symbols={symbols} label={C.glance}>
          {VERDICT_KEYS.map((k) => (
            <Row key={k} label={t.glance.names[k].charAt(0).toUpperCase() + t.glance.names[k].slice(1)}>
              {symbols.map((s) => {
                const st = v(s);
                if (!st || st.status === "loading") return <Cell key={s}><Skeleton className="h-4 w-20" /></Cell>;
                if (st.status === "error") return <Cell key={s}><IssueNote issue={st.issue} className="text-xs" /></Cell>;
                const p = st.data.points.find((x) => x.key === k);
                if (!p) return <Cell key={s}><span className="text-muted">{C.noData}</span></Cell>;
                return (
                  <Cell key={s}>
                    <span className="flex items-start gap-1.5 font-medium">
                      <Mark level={p.level} />
                      {C.levels[p.level]}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted num">{verdictEvidence(p, t.glance, lang)}</span>
                  </Cell>
                );
              })}
            </Row>
          ))}
        </Grid>
      </Panel>

      <Panel title={C.ratios} description={C.ratiosNote}>
        <Grid symbols={symbols} label={C.ratios}>
          {COMPARE_RATIOS.map((k) => {
            const def = RATIOS.find((x) => x.key === k)!;
            const rows = symbols.map((s) => {
              const st = r(s);
              return st?.status === "ok" ? st.data.ratios.find((x) => x.key === k) : undefined;
            });
            const best = bestIndex(rows.map((row) => (row?.applicable ? row.value : null)), def.better);
            return (
              <Row key={k} label={t.ratios.names[k]}>
                {symbols.map((s, i) => {
                  const st = r(s);
                  const row = rows[i];
                  if (!st || st.status === "loading") return <Cell key={s}><Skeleton className="h-4 w-14" /></Cell>;
                  if (st.status === "error") return <Cell key={s}>{k === COMPARE_RATIOS[0] ? <IssueNote issue={st.issue} className="text-xs" /> : <span className="text-muted">—</span>}</Cell>;
                  if (row && !row.applicable) return <Cell key={s}><span className="text-xs text-muted">{C.na}</span></Cell>;
                  if (!row || row.value === null) return <Cell key={s}><span className="text-muted">—</span></Cell>;
                  // Same reading as the ratios tab: how many in the industry it is above.
                  const pct = row.sector ? row.sector.percentile : null;
                  return (
                    <Cell key={s}>
                      <span className={`num ${best === i ? "font-semibold" : ""}`}>
                        {fmtRatio(k, row.value, lang)}
                        {best === i && (
                          <>
                            <span className="ml-1 text-fg" aria-hidden="true">●</span>
                            <span className="sr-only"> ({C.best})</span>
                          </>
                        )}
                      </span>
                      {pct !== null && <span className="block text-xs text-muted">{fill(C.percentile, { p: Math.round(pct) })}</span>}
                    </Cell>
                  );
                })}
              </Row>
            );
          })}
        </Grid>
      </Panel>

      <Panel title={C.valuation} description={C.valuationNote}>
        <Grid symbols={symbols} label={C.valuation}>
          {COMPARE_MULTIPLES.map((k) => (
            <Row key={k} label={t.glance.metrics[k]}>
              {symbols.map((s, i) => {
                const st = val(s);
                if (!st || st.status === "loading") return <Cell key={s}><Skeleton className="h-4 w-14" /></Cell>;
                if (st.status === "error") return <Cell key={s}>{k === COMPARE_MULTIPLES[0] && i >= 0 ? <IssueNote issue={st.issue} className="text-xs" /> : <span className="text-muted">—</span>}</Cell>;
                const m = st.data.multiples.find((x) => x.key === k);
                if (!m || !m.applicable) return <Cell key={s}><span className="text-xs text-muted">{C.na}</span></Cell>;
                if (m.value === null) return <Cell key={s}><span className="text-muted">—</span></Cell>;
                return (
                  <Cell key={s}>
                    <span className="num">{fmtMetric(k, m.value, lang)}</span>
                    {m.own && <span className="block text-xs text-muted num">{fill(C.avg, { v: fmtMetric(k, m.own.mean, lang) })}</span>}
                  </Cell>
                );
              })}
            </Row>
          ))}
        </Grid>
      </Panel>

      <Performance symbols={symbols} />
    </>
  );
}

const PCT = new Set(["grossMargin", "operatingMargin", "netMargin", "fcfMargin", "roe", "roa", "roic", "revenueGrowth", "epsGrowth", "equityToAssets"]);
function fmtRatio(k: string, v: number, lang: Lang) {
  return PCT.has(k) ? `${v < 0 ? "−" : ""}${fmtNum(Math.abs(v) * 100, lang, 1)}%` : `${fmtNum(v, lang, 2)}x`;
}

/** A table with the companies as columns; the first column stays put while the rest scroll. */
function Grid({ symbols, label, children }: { symbols: string[]; label: string; children: React.ReactNode }) {
  return (
    <div className="relative -mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6" tabIndex={0} role="region" aria-label={label}>
      <table className="w-full min-w-[34rem] border-collapse text-sm">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 w-40 bg-panel py-2 pr-3 text-left text-xs font-normal text-muted">
              <span className="sr-only">{label}</span>
            </th>
            {symbols.map((s, i) => (
              <th key={s} scope="col" className="py-2 px-2 text-left font-semibold">
                <Link href={`/stock/${enc(s)}`} prefetch={false} className="inline-flex min-h-11 items-center gap-1.5 hover:underline sm:min-h-0">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: `var(${SLOTS[i]})` }} aria-hidden="true" />
                  {s}
                </Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr className="border-t border-line align-top">
      <th scope="row" className="sticky left-0 z-10 bg-panel py-2.5 pr-3 text-left text-[13px] font-normal text-muted">
        {label}
      </th>
      {children}
    </tr>
  );
}

const Cell = ({ children }: { children: React.ReactNode }) => <td className="py-2.5 px-2 min-w-[7.5rem]">{children}</td>;

/** Month-end prices indexed to 100, five years, from the same data as the chart generator. */
function Performance({ symbols }: { symbols: string[] }) {
  const { t, lang } = useI18n();
  const C = t.compare;
  const data = useSymbolData(symbols, "monthly");
  const colors = useChartColors(SLOTS);
  const bySymbol = useMemo(() => Object.fromEntries(symbols.map((s) => [s, data[s]?.status === "ok" ? (data[s] as { series: PeriodSeries }).series : undefined])), [symbols, data]);
  const built = useMemo(() => buildChartData(symbols.map((s) => ({ id: s, symbol: s, metric: "price" as const })), bySymbol, "monthly", "index", 60), [symbols, bySymbol]);
  const series: ChartSeries[] = built.series.filter((x) => x.values.some((v) => v != null)).map((x) => ({ id: x.spec.id, label: x.spec.symbol, colorVar: SLOTS[symbols.indexOf(x.spec.symbol)], values: x.values }));
  const loading = symbols.some((s) => !data[s] || data[s].status === "loading");
  const failed = symbols.filter((s) => data[s]?.status === "error");
  const fmt = formatter("index", lang);
  const label = (short: boolean) => (k: string) => periodLabel(k, lang, short, t.charts.quarterShort);
  const href = `/charts?${writeConfig({ symbols, metrics: ["price"], freq: "monthly", transform: "index", kind: "line", range: 60 })}`;
  return (
    <Panel
      title={C.performance}
      description={C.performanceNote}
      action={
        <Link href={href} prefetch={false} className={buttonClass("ghost", true, "!px-2 text-muted")} aria-label={C.openChart} title={C.openChart}>
          <ExternalIcon size={15} />
        </Link>
      }
    >
      {loading || !colors ? (
        <Skeleton className="h-[260px] w-full rounded-lg" />
      ) : series.length === 0 ? (
        <div className="grid h-[200px] place-items-center rounded-lg bg-panel-2 px-6 text-center text-sm text-muted">{t.charts.noData}</div>
      ) : (
        <>
          <ul className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[13px]" aria-label={t.charts.legend}>
            {series.map((x) => (
              <li key={x.id} className="inline-flex items-center gap-2">
                <Swatch kind="line" color={`var(${x.colorVar})`} variant={0} />
                {x.label}
              </li>
            ))}
          </ul>
          <TrendChart
            categories={built.categories}
            categoryLabel={label(true)}
            categoryTitle={label(false)}
            series={series}
            kind="line"
            colors={colors}
            format={fmt}
            formatTick={fmt}
            reference={100}
            ariaLabel={`${C.performance}: ${symbols.join(", ")}. ${t.charts.keyboardHint}`}
            height={260}
          />
        </>
      )}
      {failed.length > 0 && !loading && (
        <p className="mt-2 text-xs text-muted">
          {failed.join(", ")}: {t.data.issuesShort[(data[failed[0]] as { error: keyof typeof t.data.issuesShort }).error] ?? ""}
        </p>
      )}
    </Panel>
  );
}
