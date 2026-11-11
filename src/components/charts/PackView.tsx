"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf } from "@/lib/format";
import { buildChartData, type PeriodSeries } from "@/lib/chartMetrics";
import { writeConfig } from "@/lib/chartConfig";
import { BUILTIN_PACKS, configFor, type Pack, type PackChart } from "@/lib/chartPacks";
import { usePacks } from "@/lib/chartPacksClient";
import TickerSearch from "../TickerSearch";
import { ChevronDownIcon, CloseIcon, ExternalIcon } from "../icons";
import { IssueNote, Panel, Skeleton, buttonClass, toast } from "../ui";
import { PeerNote } from "./ChartBuilder";
import { PEER_VAR, Readouts, SLOTS, formatter, periodLabel, usePeerLine, useSymbolData } from "./chartShared";
import TrendChart, { Swatch, useChartColors, type ChartSeries } from "./TrendChart";

const SYMBOL = /^[A-Z][A-Z.\-]{0,9}$/;
const VARS = [...SLOTS, PEER_VAR];

/** A pack of charts for one company: company and pack in the URL (?s=AAPL&p=essentials). */
export default function PackView() {
  const { t } = useI18n();
  const C = t.charts;
  const P = C.packs;
  const params = useSearchParams();
  const pathname = usePathname();
  const packs = usePacks();
  const s = (params.get("s") ?? "").toUpperCase();
  const symbol = SYMBOL.test(s) ? s : "";
  const packId = params.get("p") ?? BUILTIN_PACKS[0].id;
  const pack = packs.all.find((p) => p.id === packId) ?? packs.all[0];
  const nav = (next: { s?: string; p?: string }) => {
    const q = new URLSearchParams(params.toString());
    if (next.s) q.set("s", next.s);
    if (next.p) q.set("p", next.p);
    window.history.pushState(null, "", `${pathname}?${q.toString()}`);
  };
  const packName = (p: Pack) => (p.builtin ? P.builtin[p.name as keyof typeof P.builtin] : p.name);

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{symbol ? `${P.title}: ${symbol}` : P.title}</h1>
          <Link href={symbol ? `/charts?s=${encodeURIComponent(symbol)}` : "/charts"} className={buttonClass("secondary", true)}>
            {C.title}
          </Link>
        </div>
        <p className="mt-1 max-w-2xl text-[15px] text-muted">{P.intro}</p>
      </div>

      <section aria-label={C.controls} className="space-y-3 rounded-xl border border-line bg-panel p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:items-end">
          <div>
            <p className="control-label mb-1.5">{symbol ? P.changeCompany : P.company}</p>
            <TickerSearch placeholder={symbol || P.company} label={P.company} onSelect={(x) => nav({ s: x })} />
          </div>
          <PackPicker packs={packs.all} value={pack.id} onChange={(p) => nav({ p })} name={packName} />
        </div>
        {!pack.builtin && <ManagePack pack={pack} onDeleted={() => nav({ p: BUILTIN_PACKS[0].id })} />}
      </section>

      {!symbol ? (
        <p className="rounded-xl border border-line bg-panel px-6 py-12 text-center text-sm text-muted">{P.pick}</p>
      ) : pack.charts.length === 0 ? (
        <p className="rounded-xl border border-line bg-panel px-6 py-12 text-center text-sm text-muted">{P.empty}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {pack.charts.map((ch, i) => (
            <PackChartCard key={`${pack.id}-${i}-${JSON.stringify(ch)}`} symbol={symbol} chart={ch} pack={pack} index={i} />
          ))}
        </div>
      )}
      <p className="text-xs text-muted">
        {C.sourceSec}. {P.savedNote}
      </p>
    </div>
  );
}

function PackPicker({ packs, value, onChange, name }: { packs: Pack[]; value: string; onChange: (id: string) => void; name: (p: Pack) => string }) {
  const { t } = useI18n();
  const P = t.charts.packs;
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="control-label mb-1.5 block">
        {P.pack}
      </label>
      <div className="relative">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="h-11 w-full appearance-none rounded-lg border border-line bg-panel pl-3 pr-8 text-sm sm:h-9 sm:w-auto sm:min-w-64">
          {packs.map((p) => (
            <option key={p.id} value={p.id}>
              {name(p)} ({p.charts.length}){p.builtin ? ` · ${P.included}` : ""}
            </option>
          ))}
        </select>
        <ChevronDownIcon size={16} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted sm:left-[calc(16rem-1.75rem)] sm:right-auto" />
      </div>
    </div>
  );
}

function ManagePack({ pack, onDeleted }: { pack: Pack; onDeleted: () => void }) {
  const { t } = useI18n();
  const P = t.charts.packs;
  const packs = usePacks();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(pack.name);
  const id = useId();
  return (
    <div className="flex flex-wrap items-end gap-2">
      {renaming ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            packs.rename(pack.id, name);
            setRenaming(false);
          }}
        >
          <div>
            <label htmlFor={id} className="control-label mb-1 block">
              {P.renameLabel}
            </label>
            <input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className="h-11 w-56 rounded-lg border border-line bg-panel px-3 text-sm sm:h-9" />
          </div>
          <button type="submit" className={buttonClass("secondary", true)} disabled={!name.trim()}>
            {P.rename}
          </button>
        </form>
      ) : (
        <button type="button" className={buttonClass("ghost", true, "text-muted")} onClick={() => setRenaming(true)}>
          {P.rename}
        </button>
      )}
      <button
        type="button"
        className={buttonClass("ghost", true, "text-muted hover:text-down")}
        onClick={() => {
          const before = packs.mine;
          packs.drop(pack.id);
          onDeleted();
          toast({ message: fill(P.deleted, { n: pack.name }), action: { label: t.ux.undo, run: () => packs.restore(before) } });
        }}
      >
        {P.delete}
      </button>
    </div>
  );
}

/** One chart of a pack for one company, with its growth readouts and (when asked) the peer median. */
function PackChartCard({ symbol, chart, pack, index }: { symbol: string; chart: PackChart; pack: Pack; index: number }) {
  const { t, lang } = useI18n();
  const C = t.charts;
  const P = C.packs;
  const packs = usePacks();
  const config = useMemo(() => configFor(chart, symbol), [chart, symbol]);
  const { metrics, freq, transform, kind, range } = config;
  const data = useSymbolData([symbol], freq);
  const st = data[symbol];
  const series = st?.status === "ok" ? (st as { series: PeriodSeries }).series : undefined;
  const built = useMemo(
    () => buildChartData(metrics.map((m) => ({ id: `${symbol}:${m}`, symbol, metric: m })), { [symbol]: series }, freq, transform, range),
    [metrics, symbol, series, freq, transform, range],
  );
  const peerLine = usePeerLine(!!config.peers, symbol, metrics[0], freq, transform, built.categories);
  const colors = useChartColors(VARS);
  const visible: ChartSeries[] = built.series
    .filter((x) => x.values.some((v) => v != null))
    .map((x, i) => ({ id: x.spec.id, label: metrics.length === 1 ? symbol : C.metrics[x.spec.metric], colorVar: SLOTS[i % SLOTS.length], values: x.values }));
  if (peerLine.status === "ok" && visible.length) visible.push({ id: "peers", label: C.peers.label, colorVar: PEER_VAR, variant: 1, values: peerLine.values });
  const fmt = formatter(built.unit, lang);
  const label = (short: boolean) => (k: string) => periodLabel(k, lang, short, C.quarterShort);
  const title = metrics.map((m) => C.metrics[m]).join(" · ") + (transform === "growth" ? ` — ${C.transforms.growth.toLowerCase()}` : transform === "index" ? ` — ${C.indexTitle}` : "");
  const subtitle = [C.freqs[freq], st?.status === "ok" ? `${t.data.updated} ${fmtAsOf((st as { fetchedAt: string }).fetchedAt, lang)}` : null].filter(Boolean).join(" · ");
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  // Charts further down only draw once scrolled near, so a pack opens quickly.
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setNear(true), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  return (
    <div ref={ref}>
      <Panel
        title={title}
        description={subtitle}
        action={
          <div className="flex items-center">
            <Link href={`/charts?${writeConfig(config)}`} className={buttonClass("ghost", true, "!px-2 text-muted")} aria-label={P.openInBuilder} title={P.openInBuilder}>
              <ExternalIcon size={15} />
            </Link>
            {!pack.builtin && (
              <>
                <button type="button" className={buttonClass("ghost", true, "!px-2 text-muted")} aria-label={P.up} title={P.up} disabled={index === 0} onClick={() => packs.move(pack.id, index, -1)}>
                  <ChevronDownIcon size={15} className="rotate-180" />
                </button>
                <button type="button" className={buttonClass("ghost", true, "!px-2 text-muted")} aria-label={P.down} title={P.down} disabled={index === pack.charts.length - 1} onClick={() => packs.move(pack.id, index, 1)}>
                  <ChevronDownIcon size={15} />
                </button>
                <button type="button" className={buttonClass("ghost", true, "!px-2 text-muted hover:text-down")} aria-label={P.remove} title={P.remove} onClick={() => packs.remove(pack.id, index)}>
                  <CloseIcon size={15} />
                </button>
              </>
            )}
          </div>
        }
      >
        {st?.status === "error" ? (
          <IssueNote issue={(st as { error: Parameters<typeof IssueNote>[0]["issue"] }).error} />
        ) : !st || st.status === "loading" || !colors || !near ? (
          <Skeleton className="h-[240px] w-full rounded-lg" />
        ) : visible.length === 0 ? (
          <div className="grid h-[240px] place-items-center rounded-lg bg-panel-2 px-6 text-center text-sm text-muted">{C.noData}</div>
        ) : (
          <>
            {visible.length > 1 && (
              <ul className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[13px]" aria-label={C.legend}>
                {visible.map((v) => (
                  <li key={v.id} className="inline-flex items-center gap-2">
                    <Swatch kind={kind} color={`var(${v.colorVar})`} variant={v.variant ?? 0} />
                    {v.label}
                  </li>
                ))}
              </ul>
            )}
            <TrendChart
              categories={built.categories}
              categoryLabel={label(true)}
              categoryTitle={label(false)}
              series={visible}
              kind={kind}
              colors={colors}
              format={fmt}
              formatTick={fmt}
              reference={built.unit === "index" ? 100 : undefined}
              ariaLabel={`${title}. ${symbol}. ${C.keyboardHint}`}
              height={240}
            />
            <Readouts items={visible} unit={built.unit} freq={freq} transform={transform} format={fmt} />
            {config.peers && <PeerNote line={peerLine} />}
          </>
        )}
      </Panel>
    </div>
  );
}
