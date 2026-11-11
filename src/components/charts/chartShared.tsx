"use client";

// Shared by the chart generator and chart packs: loading each company's series, formatting
// values and period labels, the peer median line and the growth readouts.
import { useEffect, useMemo, useRef, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtBig } from "@/lib/format";
import { buildChartData, type ChartMetric, type Freq, type PeriodSeries, type Transform, type Unit } from "@/lib/chartMetrics";
import { peerMedian, readout, type Readout } from "@/lib/chartStats";
import type { FundamentalSeriesPayload, MarketSeriesPayload } from "@/lib/seriesData";
import { sharedLoader, type ViewIssue } from "@/lib/resource";
import type { PeersPayload } from "@/app/api/sec/peers/[symbol]/route";

export const SLOTS = ["--series-1", "--series-2", "--series-3", "--series-4", "--series-5", "--series-6"];

// ---- Data ------------------------------------------------------------------------------

// One shared request per URL (see lib/resource.ts); failures aren't kept, so the next view asks again.
export type SymbolState = { status: "loading" } | { status: "ok"; series: PeriodSeries; name?: string; note?: MarketSeriesPayload["multiples"]; fetchedAt: string } | { status: "error"; error: ViewIssue };

export function useSymbolData(symbols: string[], freq: Freq) {
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
export function formatter(unit: Unit | "index", lang: "es" | "en") {
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

export function periodLabel(key: string, lang: "es" | "en", short: boolean, quarterWord: string): string {
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


// ---- Peer median ------------------------------------------------------------------------

export const PEER_VAR = "--muted";
const PEERS_USED = 6;

/** Peers for a company: the ones chosen in its Comps tab (this browser), else the suggested ones. */
function chosenPeers(symbol: string): string[] | null {
  try {
    const raw = localStorage.getItem(`iep:comps:peers:${symbol}`);
    const list = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === "string" && s !== symbol).slice(0, PEERS_USED) : null;
  } catch {
    return null;
  }
}

export type PeerLine =
  | { status: "off" }
  | { status: "loading" }
  | { status: "ok"; values: (number | null)[]; peers: string[]; used: number; source: "comps" | "suggested" }
  | { status: "error"; issue: ViewIssue | "noPeers" };

type PeerList = { symbol: string; peers: string[]; source: "comps" | "suggested" } | { symbol: string; issue: ViewIssue | "noPeers" };

/**
 * The median of the company's peers on the chart's own periods: each peer's series is
 * transformed on its own (so growth is each peer's growth), then matched by period key.
 */
export function usePeerLine(enabled: boolean, symbol: string, metric: ChartMetric, freq: Freq, transform: Transform, categories: string[]): PeerLine {
  const [list, setList] = useState<PeerList | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const mine = chosenPeers(symbol);
    if (mine?.length) {
      setList({ symbol, peers: mine, source: "comps" });
      return;
    }
    sharedLoader.load<PeersPayload>(`/api/sec/peers/${encodeURIComponent(symbol)}`).then((r) => {
      if (!alive) return;
      if (!r.ok) setList({ symbol, issue: r.error });
      else if (!r.data.peers.length) setList({ symbol, issue: "noPeers" });
      else setList({ symbol, peers: r.data.peers, source: "suggested" });
    });
    return () => {
      alive = false;
    };
  }, [enabled, symbol]);
  const peers = enabled && list && list.symbol === symbol && "peers" in list ? list.peers : [];
  const data = useSymbolData(peers, freq === "monthly" ? "annual" : freq);
  const catKey = categories.join(",");
  const peerKey = peers.join(",");
  return useMemo((): PeerLine => {
    if (!enabled) return { status: "off" };
    if (!list || list.symbol !== symbol) return { status: "loading" };
    if ("issue" in list) return { status: "error", issue: list.issue };
    const names = peerKey.split(",");
    if (names.some((p) => !data[p] || data[p].status === "loading")) return { status: "loading" };
    const cats = catKey.split(",");
    const rows = names.flatMap((p) => {
      const st = data[p];
      if (st?.status !== "ok") return [];
      const d = buildChartData([{ id: p, symbol: p, metric }], { [p]: st.series }, freq, transform, 0);
      const byKey = new Map(d.categories.map((k, i) => [k, d.series[0].values[i]]));
      return [cats.map((k) => byKey.get(k) ?? null)];
    });
    const m = peerMedian(rows);
    if (m.values.every((v) => v === null)) return { status: "error", issue: "noPeers" };
    return { status: "ok", values: m.values, peers: names, used: Math.max(...m.counts), source: list.source };
  }, [enabled, list, symbol, peerKey, data, metric, freq, transform, catKey]);
}

// ---- Readouts -------------------------------------------------------------------------------

export function Readouts({
  items,
  unit,
  freq,
  transform,
  format,
}: {
  items: { id: string; label: string; values: (number | null)[] }[];
  unit: Unit | "index";
  freq: Freq;
  transform: Transform;
  format: (v: number) => string;
}) {
  const { t, lang } = useI18n();
  const R = t.charts.readout;
  const lines = items.flatMap((s) => {
    const r = readout(s.values, unit, freq, transform);
    return r ? [{ s, r }] : [];
  });
  if (!lines.length) return null;
  const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${nf(lang, 1).format(Math.abs(v) * 100)}%`;
  const text = (r: Readout) => {
    switch (r.kind) {
      case "cagr":
        return fill(R.cagr, { v: pct(r.rate), n: nf(lang, r.years % 1 ? 1 : 0).format(r.years), a: format(r.from), b: format(r.to) });
      case "points":
        return fill(R.points, { v: `${r.change > 0 ? "+" : r.change < 0 ? "−" : ""}${nf(lang, 1).format(Math.abs(r.change) * 100)}`, a: format(r.from), b: format(r.to) });
      case "change":
        return fill(R.change, { a: format(r.from), b: format(r.to) });
      case "median":
        return fill(R.median, { v: pct(r.value), n: r.n });
    }
  };
  return (
    <ul className="mt-3 space-y-0.5 text-[13px]" aria-label={R.title}>
      {lines.map(({ s, r }) => (
        <li key={s.id}>
          <span className="font-medium">{s.label}:</span> <span className="num">{text(r)}</span>
        </li>
      ))}
    </ul>
  );
}

export const shortMoney = (v: number) => `${v < 0 ? "−" : ""}$${fmtBig(Math.abs(v))}`;
