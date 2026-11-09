"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtBig } from "@/lib/format";
import {
  GROUPS,
  MARKET_KEYS,
  MAX_METRICS,
  MAX_SERIES,
  MAX_SYMBOLS,
  METRICS,
  RANGES,
  buildChartData,
  compatible,
  metricDef,
  type ChartMetric,
  type Freq,
  type PeriodSeries,
  type SeriesSpec,
  type Transform,
  type Unit,
} from "@/lib/chartMetrics";
import { parseConfig, writeConfig, type ChartConfig as Config } from "@/lib/chartConfig";
import type { FundamentalSeriesPayload, MarketSeriesPayload } from "@/lib/seriesData";
import { sharedLoader, type ViewIssue } from "@/lib/resource";
import TickerSearch from "../TickerSearch";
import { ChevronDownIcon, CloseIcon, DownloadIcon, LinkIcon, TableIcon } from "../icons";
import { Panel, Segmented, Skeleton, StatusMessage, buttonClass, toast } from "../ui";
import TrendChart, { Swatch, useChartColors, type ChartSeries, type TrendChartHandle } from "./TrendChart";

const SLOTS = ["--series-1", "--series-2", "--series-3", "--series-4", "--series-5", "--series-6"];

// ---- Data ------------------------------------------------------------------------------

// One shared request per URL (see lib/resource.ts); failures aren't kept, so the next view asks again.
type SymbolState = { status: "loading" } | { status: "ok"; series: PeriodSeries; name?: string; note?: MarketSeriesPayload["multiples"]; fetchedAt: string } | { status: "error"; error: ViewIssue };

function useSymbolData(symbols: string[], freq: Freq) {
  const [state, setState] = useState<Record<string, SymbolState>>({});
  const key = `${symbols.join(",")}|${freq}`;
  const lastFreq = useRef<Freq | null>(null);
  useEffect(() => {
    let alive = true;
    const list = key.split("|")[0].split(",").filter(Boolean);
    const f = key.split("|")[1] as Freq;
    setState((prev) => Object.fromEntries(list.map((s) => [s, prev[s]?.status === "ok" && f === lastFreq.current ? prev[s] : { status: "loading" }])));
    lastFreq.current = f;
    for (const s of list) {
      const done = (next: SymbolState) => alive && setState((prev) => ({ ...prev, [s]: next }));
      if (f === "monthly") {
        sharedLoader.load<MarketSeriesPayload>(`/api/charts/market/${encodeURIComponent(s)}`).then((r) =>
          done(r.ok ? { status: "ok", series: r.data.monthly, note: r.data.multiples, fetchedAt: r.fetchedAt } : { status: "error", error: r.error }),
        );
      } else {
        sharedLoader.load<FundamentalSeriesPayload>(`/api/sec/series/${encodeURIComponent(s)}`).then((r) =>
          done(r.ok ? { status: "ok", series: r.data[f as "annual" | "quarterly"], name: r.data.name, fetchedAt: r.fetchedAt } : { status: "error", error: r.error }),
        );
      }
    }
    return () => {
      alive = false;
    };
  }, [key]);
  return state;
}

// ---- Formatting ---------------------------------------------------------------------------

const nf = (lang: "es" | "en", d: number) => new Intl.NumberFormat(lang === "es" ? "es-US" : "en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Fewest decimals (0-2) that show a tick step exactly: 2.5% needs one, 5% none. */
function stepDecimals(step: number): number {
  for (let d = 0; d < 2; d++) if (Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) < 1e-6) return d;
  return 2;
}

/** Readouts (tooltip, table) with fixed decimals; ticks (step given) with as few as the step needs. */
function formatter(unit: Unit | "index", lang: "es" | "en") {
  return (v: number, step?: number): string => {
    const neg = v < 0 ? "−" : "";
    const a = Math.abs(v);
    const tick = step !== undefined;
    switch (unit) {
      case "usd":
        return `${neg}$${fmtBig(a)}`;
      case "count":
        return `${neg}${fmtBig(a)}`;
      case "perShare":
        return `${neg}$${nf(lang, tick ? stepDecimals(step) : 2).format(a)}`;
      case "pct":
        return `${neg}${nf(lang, tick ? stepDecimals(step * 100) : 1).format(a * 100)}%`;
      case "multiple":
        return `${neg}${nf(lang, tick ? stepDecimals(step) : 1).format(a)}x`;
      case "index":
        return `${neg}${nf(lang, tick ? stepDecimals(step) : 1).format(a)}`;
    }
  };
}

function periodLabel(key: string, lang: "es" | "en", short: boolean, quarterWord: string): string {
  if (key.startsWith("FY")) return short ? `FY${key.slice(4)}` : key;
  const q = key.match(/^(\d{4})-Q(\d)$/);
  if (q) return short ? `${quarterWord}${q[2]} ${q[1].slice(2)}` : `${quarterWord}${q[2]} ${q[1]}`;
  const mo = key.match(/^(\d{4})-(\d{2})$/);
  if (mo) {
    const d = new Date(Date.UTC(+mo[1], +mo[2] - 1, 1));
    return new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { month: "short", year: short ? "2-digit" : "numeric", timeZone: "UTC" }).format(d);
  }
  return key;
}

// ---- Page ------------------------------------------------------------------------------------

export default function ChartBuilder() {
  const { t, lang } = useI18n();
  const C = t.charts;
  const params = useSearchParams();
  const pathname = usePathname();
  // The chart lives in state (instant, no flicker) and is mirrored to the URL for sharing. A URL
  // that changes from outside (Back, a link to another chart) is followed.
  const urlConfig = writeConfig(parseConfig(new URLSearchParams(params.toString())));
  const [config, setConfig] = useState<Config>(() => parseConfig(new URLSearchParams(urlConfig)));
  const written = useRef(urlConfig);
  useEffect(() => {
    if (urlConfig === written.current) return;
    written.current = urlConfig;
    setConfig(parseConfig(new URLSearchParams(urlConfig)));
  }, [urlConfig]);
  const { symbols, metrics, freq, transform, kind, range } = config;
  const chartRef = useRef<TrendChartHandle>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const update = useCallback(
    (patch: Partial<Config>) => {
      const next = { ...config, ...patch };
      if (patch.freq && patch.freq !== config.freq) {
        next.metrics = next.metrics.filter((m) => metricDef(m).freqs.includes(next.freq));
        if (!next.metrics.length) next.metrics = [next.freq === "monthly" ? "pe" : "revenue"];
        next.range = RANGES[next.freq][1];
        if (next.freq === "annual" && config.freq !== "annual") next.kind = "bar";
        if (next.freq !== "annual") next.kind = "line";
      }
      if (patch.transform && !compatible(next.metrics, next.transform)) {
        next.metrics = next.metrics.filter((m) => metricDef(m).unit === metricDef(next.metrics[0]).unit);
      }
      const qs = writeConfig(next);
      written.current = qs;
      setConfig(next);
      window.history.replaceState(null, "", `${pathname}?${qs}`);
    },
    [config, pathname],
  );

  const data = useSymbolData(symbols, freq);

  // Series: one per company and metric. Colour follows the company (or the metric, for a single
  // company); a company's second and third metric are dashed/dotted lines or lighter bars.
  const specs: SeriesSpec[] = symbols.flatMap((s) => metrics.map((m) => ({ id: `${s}:${m}`, symbol: s, metric: m })));
  const bySymbol = Object.fromEntries(symbols.map((s) => [s, data[s]?.status === "ok" ? (data[s] as { series: PeriodSeries }).series : undefined]));
  const chart = useMemo(() => buildChartData(specs, bySymbol, freq, transform, range), [JSON.stringify(specs), data, freq, transform, range]);
  const colorOf = (spec: SeriesSpec) => SLOTS[(symbols.length > 1 ? symbols.indexOf(spec.symbol) : metrics.indexOf(spec.metric)) % SLOTS.length];
  const variantOf = (spec: SeriesSpec) => (symbols.length > 1 ? (Math.min(2, metrics.indexOf(spec.metric)) as 0 | 1 | 2) : 0);
  const nameOf = (spec: SeriesSpec) =>
    metrics.length === 1 ? spec.symbol : symbols.length === 1 ? C.metrics[spec.metric] : `${spec.symbol} · ${C.metrics[spec.metric]}`;
  const visible: ChartSeries[] = chart.series
    .filter((s) => !hidden.has(s.spec.id) && s.values.some((v) => v != null))
    .map((s) => ({ id: s.spec.id, label: nameOf(s.spec), colorVar: colorOf(s.spec), variant: variantOf(s.spec), values: s.values }));
  const colors = useChartColors(SLOTS);

  const unit = chart.unit;
  const fmt = formatter(unit, lang);
  const catLabel = (short: boolean) => (k: string) => periodLabel(k, lang, short, C.quarterShort);
  const loading = symbols.some((s) => !data[s] || data[s].status === "loading");
  const errors = symbols.filter((s) => data[s]?.status === "error");
  const anyData = visible.length > 0;

  const title = metrics.map((m) => C.metrics[m]).join(" · ") + (transform === "growth" ? ` — ${C.transforms.growth.toLowerCase()}` : transform === "index" ? ` — ${C.indexTitle}` : "");
  const subtitle = [symbols.join(", "), C.freqs[freq], unit === "index" ? C.indexNote : null].filter(Boolean).join(" · ");
  const latestFetch = symbols.map((s) => (data[s]?.status === "ok" ? (data[s] as { fetchedAt: string }).fetchedAt : "")).filter(Boolean).sort().at(-1);

  // ---- Actions
  const exportCsv = () => {
    const header = [C.period, ...visible.map((s) => `${s.label}${unit === "pct" ? " (%)" : ""}`)];
    const rows = chart.categories.map((c, i) => [
      periodLabel(c, lang, false, C.quarterShort),
      ...visible.map((s) => {
        const v = s.values[i];
        return v == null ? "" : String(unit === "pct" ? +(v * 100).toFixed(4) : +v.toPrecision(10));
      }),
    ]);
    const csv = [header, ...rows].map((r) => r.map((x) => (/[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(",")).join("\n");
    download(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${fileBase(config)}.csv`);
  };
  const exportPng = async () => {
    const svg = chartRef.current?.svg;
    if (!svg || !colors) return;
    const blob = await svgToPng(svg, { title, subtitle, legend: visible.map((s) => ({ label: s.label, color: colors.series[s.colorVar], variant: s.variant ?? 0 })), kind, source: C.source, colors });
    if (blob) download(blob, `${fileBase(config)}.png`);
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast({ message: C.linkCopied });
    } catch {
      toast({ message: C.linkFailed });
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{C.title}</h1>
        <p className="mt-1 text-[15px] text-muted max-w-2xl">{C.intro}</p>
      </div>

      {/* Controls: one row above the chart (wraps on small screens). */}
      <section aria-label={C.controls} className="rounded-xl border border-line bg-panel p-4 sm:p-5 space-y-4">
        <div>
          <p className="control-label mb-1.5" id="companies-label">
            {fill(C.companies, { n: symbols.length, max: MAX_SYMBOLS })}
          </p>
          <div className="flex flex-wrap items-center gap-2" aria-labelledby="companies-label">
            {symbols.map((s) => (
              <span key={s} className="inline-flex items-center gap-0.5 h-11 sm:h-9 pl-3 pr-0.5 rounded-lg bg-panel-2 text-sm font-medium">
                {s}
                <button type="button" className="grid h-11 w-10 sm:h-8 sm:w-8 place-items-center rounded-md text-muted hover:text-fg" aria-label={fill(C.removeCompany, { s })} onClick={() => update({ symbols: symbols.filter((x) => x !== s) })}>
                  <CloseIcon size={14} />
                </button>
              </span>
            ))}
            {symbols.length < MAX_SYMBOLS && symbols.length * metrics.length < MAX_SERIES && (
              <div className="w-full sm:w-64">
                <TickerSearch
                  placeholder={C.addCompany}
                  label={C.addCompany}
                  onSelect={(s) => {
                    if (!symbols.includes(s)) update({ symbols: [...symbols, s] });
                  }}
                />
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end sm:gap-x-5 sm:gap-y-4">
          <div className="col-span-2 sm:col-span-1 min-w-0">
            <MetricPicker config={config} onChange={(m) => update({ metrics: m })} />
          </div>
          <Choice label={C.frequency} value={freq} onChange={(f) => update({ freq: f })} options={(["annual", "quarterly", "monthly"] as Freq[]).map((f) => ({ value: f, label: C.freqs[f] }))} />
          <Choice
            label={C.range}
            value={String(range)}
            onChange={(r) => update({ range: Number(r) })}
            options={RANGES[freq].map((r) => ({ value: String(r), label: r === 0 ? C.all : rangeLabel(freq, r, C) }))}
          />
          <Choice label={C.show} value={transform} onChange={(x) => update({ transform: x })} options={(["values", "growth", "index"] as Transform[]).map((x) => ({ value: x, label: C.transforms[x] }))} />
          <Choice label={C.type} value={kind} onChange={(k) => update({ kind: k })} options={[{ value: "bar" as const, label: C.bars }, { value: "line" as const, label: C.lines }]} />
        </div>
      </section>

      <Panel
        title={title}
        description={subtitle}
        id="chart"
        action={
          anyData ? (
            <div className="flex items-center gap-1">
              <button type="button" className={buttonClass("ghost", true, "!px-2 text-muted")} onClick={exportPng} aria-label={C.png} title={C.png}>
                <DownloadIcon size={16} />
                <span className="hidden sm:inline">PNG</span>
              </button>
              <button type="button" className={buttonClass("ghost", true, "!px-2 text-muted")} onClick={exportCsv} aria-label={C.csv} title={C.csv}>
                <TableIcon size={16} />
                <span className="hidden sm:inline">CSV</span>
              </button>
              <button type="button" className={buttonClass("ghost", true, "!px-2 text-muted")} onClick={copyLink} aria-label={C.copyLink} title={C.copyLink}>
                <LinkIcon size={16} />
              </button>
            </div>
          ) : undefined
        }
      >
        {symbols.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted">{C.empty}</p>
        ) : (
          <>
            {visible.length + hidden.size >= 2 && (
              <ul className="mb-3 flex flex-wrap gap-x-1 gap-y-1" aria-label={C.legend}>
                {chart.series
                  .filter((s) => s.values.some((v) => v != null))
                  .map((s) => {
                    const off = hidden.has(s.spec.id);
                    return (
                      <li key={s.spec.id}>
                        <button
                          type="button"
                          aria-pressed={!off}
                          onClick={() => setHidden((h) => {
                            const n = new Set(h);
                            if (n.has(s.spec.id)) n.delete(s.spec.id);
                            else n.add(s.spec.id);
                            return n;
                          })}
                          className={`inline-flex items-center gap-2 min-h-9 px-2 rounded-md text-[13px] hover:bg-panel-2 ${off ? "text-muted line-through" : ""}`}
                        >
                          <Swatch kind={kind} color={off ? "var(--border-strong)" : `var(${colorOf(s.spec)})`} variant={variantOf(s.spec)} />
                          {nameOf(s.spec)}
                        </button>
                      </li>
                    );
                  })}
              </ul>
            )}
            <div className={`transition-opacity ${loading && anyData ? "opacity-50" : ""}`}>
              {!colors || (loading && !anyData) ? (
                <Skeleton className="h-[320px] w-full rounded-lg" />
              ) : anyData ? (
                <TrendChart
                  ref={chartRef}
                  categories={chart.categories}
                  categoryLabel={catLabel(true)}
                  categoryTitle={catLabel(false)}
                  series={visible}
                  kind={kind}
                  colors={colors}
                  format={fmt}
                  formatTick={fmt}
                  reference={unit === "index" ? 100 : undefined}
                  ariaLabel={`${title}. ${subtitle}. ${C.keyboardHint}`}
                />
              ) : (
                <div className="grid h-[320px] place-items-center rounded-lg bg-panel-2 px-6 text-center text-sm text-muted">{C.noData}</div>
              )}
            </div>
            {anyData && <ChartTable categories={chart.categories} label={catLabel(false)} series={visible} format={fmt} />}
          </>
        )}

        {/* Per-company problems, said plainly. */}
        {(errors.length > 0 || symbols.some((s) => data[s]?.status === "ok" && freq === "monthly" && (data[s] as { note?: string }).note !== "ok")) && (
          <div className="mt-4 space-y-1.5">
            {errors.map((s) => {
              const e = (data[s] as { error: ViewIssue }).error;
              return (
                <StatusMessage key={s} tone="warn">
                  <strong className="font-medium text-fg">{s}</strong>: {e === "beta_expired" ? t.data.betaExpired : freq === "monthly" && e === "not_configured" ? C.marketUnavailable : t.data.issues[e]}
                </StatusMessage>
              );
            })}
            {symbols
              .filter((s) => data[s]?.status === "ok" && freq === "monthly" && (data[s] as { note?: string }).note !== "ok" && metrics.some((m) => m !== "price"))
              .map((s) => (
                <StatusMessage key={`${s}-note`}>
                  <strong className="font-medium text-fg">{s}</strong>: {C.multiplesNote[(data[s] as { note: "sharesMismatch" | "noFilings" }).note]}
                </StatusMessage>
              ))}
          </div>
        )}

        <div className="mt-4 space-y-1 text-xs text-muted">
          <p>{freq === "annual" ? C.methodAnnual : freq === "quarterly" ? C.methodQuarterly : C.methodMonthly}</p>
          <p>
            {freq === "monthly" ? C.sourceMarket : C.sourceSec}
            {latestFetch && ` · ${t.data.updated} ${fmtAsOf(latestFetch, lang)}`}
          </p>
        </div>
      </Panel>

      <p className="text-xs text-muted">
        {C.fromStockHint}{" "}
        {symbols[0] && (
          <Link href={`/stock/${encodeURIComponent(symbols[0])}`} className="underline underline-offset-2 hover:text-fg">
            {fill(C.openStock, { s: symbols[0] })}
          </Link>
        )}
      </p>
    </div>
  );
}

/** One option: a segmented control from sm up, a native select on phones (fits two per row). */
function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="control-label mb-1.5 block">
        {label}
      </label>
      <div className="relative sm:hidden">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          className="h-11 w-full appearance-none rounded-lg border border-line bg-panel pl-3 pr-8 text-sm"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDownIcon size={16} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" />
      </div>
      <Segmented className="hidden sm:inline-flex" label={label} value={value} onChange={onChange} options={options} />
    </div>
  );
}

function rangeLabel(freq: Freq, r: number, C: ReturnType<typeof useI18n>["t"]["charts"]) {
  const n = freq === "annual" ? r : freq === "quarterly" ? r / 4 : r / 12;
  return n === 1 ? C.oneYear : fill(C.years, { n });
}

// ---- Metric picker -------------------------------------------------------------------------

function MetricPicker({ config, onChange }: { config: Config; onChange: (m: ChartMetric[]) => void }) {
  const { t } = useI18n();
  const C = t.charts;
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const { metrics, freq, transform, symbols } = config;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unit0 = metrics.length ? metricDef(metrics[0]).unit : null;
  const reason = (k: ChartMetric): string | null => {
    const d = metricDef(k);
    if (metrics.includes(k)) return metrics.length === 1 ? C.lastMetric : null;
    if (!d.freqs.includes(freq)) return freq === "monthly" ? C.onlyFundamentals : MARKET_KEYS.includes(k as never) ? C.onlyMonthly : C.onlyAnnual;
    if (metrics.length >= MAX_METRICS) return fill(C.maxMetrics, { n: MAX_METRICS });
    if ((metrics.length + 1) * Math.max(1, symbols.length) > MAX_SERIES) return fill(C.maxSeries, { n: MAX_SERIES });
    if (transform === "values" && unit0 && d.unit !== unit0) return C.otherUnit;
    return null;
  };
  const toggle = (k: ChartMetric) => {
    if (metrics.includes(k)) {
      if (metrics.length > 1) onChange(metrics.filter((m) => m !== k));
    } else if (!reason(k)) onChange([...metrics, k]);
  };

  return (
    <div ref={boxRef} className="relative">
      <p className="control-label mb-1.5" aria-hidden="true">
        {C.metric}
      </p>
      <button
        ref={btnRef}
        type="button"
        aria-expanded={open}
        aria-controls="metric-list"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center justify-between gap-2 h-11 sm:h-9 w-full sm:w-auto sm:min-w-56 sm:max-w-80 rounded-lg border border-line bg-panel px-3 text-sm hover:border-line-strong"
      >
        <span className="truncate">{metrics.map((m) => C.metrics[m]).join(", ")}</span>
        <ChevronDownIcon size={16} className={`text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id="metric-list" className="absolute left-0 z-30 mt-1 w-[min(22rem,calc(100vw-2rem))] max-h-[60vh] overflow-auto rounded-xl border border-line bg-panel p-2 shadow-xl">
          {GROUPS.map((g) => {
            const items = METRICS.filter((m) => m.group === g);
            return (
              <fieldset key={g} className="py-1">
                <legend className="px-2 pt-1 pb-1 text-xs font-medium text-muted">{C.groups[g]}</legend>
                {items.map((m) => {
                  const why = reason(m.key);
                  const on = metrics.includes(m.key);
                  const disabled = !on && !!why;
                  return (
                    <label
                      key={m.key}
                      className={`flex items-center gap-2.5 min-h-10 px-2 rounded-lg text-sm ${disabled ? "text-muted cursor-not-allowed" : "cursor-pointer hover:bg-panel-2"}`}
                      title={why ?? undefined}
                    >
                      <input type="checkbox" className="h-4 w-4 accent-[var(--text)]" checked={on} disabled={disabled || (on && metrics.length === 1)} onChange={() => toggle(m.key)} />
                      <span className="flex-1">{C.metrics[m.key]}</span>
                      {disabled && why && <span className="text-[11px] text-muted text-right max-w-[9rem] leading-tight">{why}</span>}
                    </label>
                  );
                })}
              </fieldset>
            );
          })}
          <p className="px-2 pt-2 pb-1 text-xs text-muted border-t border-line mt-1">{C.mixHint}</p>
        </div>
      )}
    </div>
  );
}

// ---- Table, export --------------------------------------------------------------------------

function ChartTable({ categories, label, series, format }: { categories: string[]; label: (k: string) => string; series: ChartSeries[]; format: (v: number) => string }) {
  const { t } = useI18n();
  return (
    <details className="mt-3 text-sm">
      <summary className="inline-flex items-center gap-1.5 min-h-9 cursor-pointer text-[13px] text-muted hover:text-fg">
        <TableIcon size={15} />
        {t.charts.table}
      </summary>
      <div className="relative mt-2 max-h-80 overflow-auto rounded-lg border border-line" tabIndex={0} role="region" aria-label={t.charts.table}>
        <table className="num w-full text-[13px]">
          <thead className="sticky top-0 bg-panel">
            <tr className="text-muted">
              <th scope="col" className="px-3 py-2 text-left font-medium">{t.charts.period}</th>
              {series.map((s) => (
                <th key={s.id} scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories
              .map((c, i) => ({ c, i }))
              .reverse()
              .map(({ c, i }) => (
                <tr key={c} className="border-t border-line">
                  <th scope="row" className="px-3 py-1.5 text-left font-normal">{label(c)}</th>
                  {series.map((s) => (
                    <td key={s.id} className="px-3 py-1.5 text-right">{s.values[i] == null ? "—" : format(s.values[i]!)}</td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function fileBase(c: Config) {
  return `iep-${c.metrics.join("-")}-${c.symbols.join("-")}-${c.freq}`.toLowerCase().replace(/[^a-z0-9.-]+/g, "-");
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The chart plus its title, legend and source, as a 2× PNG. */
async function svgToPng(
  svg: SVGSVGElement,
  o: { title: string; subtitle: string; legend: { label: string; color: string; variant: number }[]; kind: "line" | "bar"; source: string; colors: { text: string; muted: string; surface: string } },
): Promise<Blob | null> {
  const w = svg.width.baseVal.value;
  const h = svg.height.baseVal.value;
  const pad = 20;
  const W = w + pad * 2;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  // Legend items flow into rows that fit the image width.
  let x = pad;
  let row = 0;
  const items = o.legend.length > 1 ? o.legend : [];
  const legend = items
    .map((l) => {
      const itemW = 32 + l.label.length * 7;
      if (x > pad && x + itemW > W - pad) {
        x = pad;
        row++;
      }
      const top = 58 + row * 22;
      const key =
        o.kind === "bar"
          ? `<rect x="${x}" y="${top}" width="10" height="10" rx="3" fill="${l.color}" fill-opacity="${[1, 0.6, 0.32][l.variant]}"/>`
          : `<line x1="${x}" x2="${x + 14}" y1="${top + 5}" y2="${top + 5}" stroke="${l.color}" stroke-width="2" stroke-linecap="round"${l.variant ? ` stroke-dasharray="${["", "6 4", "1.5 3.5"][l.variant]}"` : ""}/>`;
      const item = `${key}<text x="${x + 20}" y="${top + 9}" font-size="12" fill="${o.colors.text}">${esc(l.label)}</text>`;
      x += itemW;
      return item;
    })
    .join("");
  const head = 64 + (items.length ? 24 + row * 22 : 0);
  const foot = 30;
  const H = h + head + foot;
  const inner = new XMLSerializer().serializeToString(svg).replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, -apple-system, Segoe UI, sans-serif">
<rect width="${W}" height="${H}" fill="${o.colors.surface}"/>
<text x="${pad}" y="28" font-size="16" font-weight="600" fill="${o.colors.text}">${esc(o.title)}</text>
<text x="${pad}" y="47" font-size="12" fill="${o.colors.muted}">${esc(o.subtitle)}</text>
${legend}
<g transform="translate(${pad},${head})">${inner}</g>
<text x="${pad}" y="${H - 10}" font-size="11" fill="${o.colors.muted}">${esc(o.source)} · IEP Analytics</text>
</svg>`;
  const img = new Image();
  const url = URL.createObjectURL(new Blob([doc], { type: "image/svg+xml;charset=utf-8" }));
  try {
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("svg"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = W * 2;
    canvas.height = H * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);
    return await new Promise((res) => canvas.toBlob((b) => res(b), "image/png"));
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
