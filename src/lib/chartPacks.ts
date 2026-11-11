// Chart packs: sets of charts saved without a company, opened for any stock in one click.
// Built-in packs ship with the app; your own live in this browser. Pure: validation and
// edits here, storage in chartPacksClient.ts.
import { canHavePeers, parseConfig, writeConfig, type ChartConfig, type ChartKind } from "./chartConfig";
import type { ChartMetric, Freq, Transform } from "./chartMetrics";

export interface PackChart {
  metrics: ChartMetric[];
  freq: Freq;
  transform: Transform;
  kind: ChartKind;
  range: number;
  peers: boolean; // add the peer median (one metric, annual or quarterly)
}

export interface Pack {
  id: string;
  name: string; // a built-in pack's name is a dictionary key
  charts: PackChart[];
  builtin?: true;
}

export const MAX_PACKS = 12;
export const MAX_CHARTS = 9;
export const NAME_MAX = 40;

const c = (metrics: ChartMetric[], o: Partial<PackChart> = {}): PackChart => ({ metrics, freq: "annual", transform: "values", kind: "bar", range: 10, peers: false, ...o });

export const BUILTIN_PACKS: Pack[] = [
  {
    id: "essentials",
    name: "essentials",
    builtin: true,
    charts: [
      c(["revenue", "netIncome"]),
      c(["revenue"], { transform: "growth", kind: "line", peers: true }),
      c(["grossMargin", "operatingMargin", "netMargin"], { kind: "line" }),
      c(["freeCashFlow"]),
      c(["eps"]),
      c(["roic"], { kind: "line", peers: true }),
      c(["shares"], { kind: "line" }),
      c(["debtToEquity"], { kind: "line", peers: true }),
    ],
  },
  {
    id: "quarters",
    name: "quarters",
    builtin: true,
    charts: [
      c(["revenue"], { freq: "quarterly", range: 12 }),
      c(["revenue"], { freq: "quarterly", range: 12, transform: "growth", kind: "line", peers: true }),
      c(["operatingMargin"], { freq: "quarterly", range: 12, kind: "line", peers: true }),
      c(["freeCashFlow"], { freq: "quarterly", range: 12 }),
      c(["eps"], { freq: "quarterly", range: 12 }),
    ],
  },
  {
    id: "shareholders",
    name: "shareholders",
    builtin: true,
    charts: [
      c(["dividendsPaid", "buybacks"]),
      c(["dividendsPerShare"]),
      c(["shares"], { kind: "line" }),
      c(["fcfPerShare", "eps"]),
    ],
  },
];

/** A pack chart as a full chart config for `symbol` (validated like any chart URL). */
export function configFor(chart: PackChart, symbol: string): ChartConfig {
  const cfg = parseConfig(new URLSearchParams(writeConfig({ ...chart, symbols: [symbol] })));
  return { ...cfg, peers: canHavePeers(cfg) && chart.peers };
}

/** What a pack keeps from the chart on screen: everything but the companies. */
export function chartFromConfig(cfg: ChartConfig): PackChart {
  return { metrics: cfg.metrics, freq: cfg.freq, transform: cfg.transform, kind: cfg.kind, range: cfg.range, peers: canHavePeers(cfg) && cfg.peers === true };
}

export { canHavePeers } from "./chartConfig";

const chartKey = (ch: PackChart) => JSON.stringify([ch.metrics, ch.freq, ch.transform, ch.kind, ch.range, ch.peers]);

function parseChart(raw: unknown): PackChart | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.metrics) || !r.metrics.length) return null;
  const qs = new URLSearchParams({ s: "X", m: r.metrics.join(","), f: String(r.freq ?? ""), t: String(r.transform ?? ""), k: String(r.kind ?? ""), r: String(r.range ?? "") });
  const cfg = parseConfig(qs);
  return chartFromConfig({ ...cfg, symbols: ["X"], peers: r.peers === true });
}

export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, NAME_MAX).trim();
}

/** Your packs from storage: valid charts only, unique ids, within the limits. */
export function parsePacks(raw: unknown): Pack[] {
  if (!Array.isArray(raw)) return [];
  const out: Pack[] = [];
  const ids = new Set(BUILTIN_PACKS.map((p) => p.id));
  for (const item of raw) {
    if (!item || typeof item !== "object" || out.length >= MAX_PACKS) continue;
    const r = item as Record<string, unknown>;
    const id = typeof r.id === "string" && /^[a-z0-9-]{1,40}$/.test(r.id) ? r.id : null;
    const name = typeof r.name === "string" ? cleanName(r.name) : "";
    if (!id || ids.has(id) || !name) continue;
    const seen = new Set<string>();
    const charts = (Array.isArray(r.charts) ? r.charts : [])
      .map(parseChart)
      .filter((ch): ch is PackChart => !!ch && !seen.has(chartKey(ch)) && (seen.add(chartKey(ch)), true))
      .slice(0, MAX_CHARTS);
    ids.add(id);
    out.push({ id, name, charts });
  }
  return out;
}

export type PackEdit = { ok: true; packs: Pack[] } | { ok: false; reason: "full" | "duplicate" | "limit" | "name" };

export function createPack(packs: Pack[], name: string, id: string, first?: PackChart): PackEdit {
  const n = cleanName(name);
  if (!n) return { ok: false, reason: "name" };
  if (packs.length >= MAX_PACKS) return { ok: false, reason: "limit" };
  return { ok: true, packs: [...packs, { id, name: n, charts: first ? [first] : [] }] };
}

export function addChart(packs: Pack[], packId: string, chart: PackChart): PackEdit {
  const pack = packs.find((p) => p.id === packId);
  if (!pack) return { ok: false, reason: "name" };
  if (pack.charts.some((ch) => chartKey(ch) === chartKey(chart))) return { ok: false, reason: "duplicate" };
  if (pack.charts.length >= MAX_CHARTS) return { ok: false, reason: "full" };
  return { ok: true, packs: packs.map((p) => (p.id === packId ? { ...p, charts: [...p.charts, chart] } : p)) };
}

export function removeChart(packs: Pack[], packId: string, index: number): Pack[] {
  return packs.map((p) => (p.id === packId ? { ...p, charts: p.charts.filter((_, i) => i !== index) } : p));
}

export function moveChart(packs: Pack[], packId: string, index: number, by: -1 | 1): Pack[] {
  return packs.map((p) => {
    if (p.id !== packId) return p;
    const j = index + by;
    if (j < 0 || j >= p.charts.length) return p;
    const charts = [...p.charts];
    [charts[index], charts[j]] = [charts[j], charts[index]];
    return { ...p, charts };
  });
}

export function renamePack(packs: Pack[], packId: string, name: string): Pack[] {
  const n = cleanName(name);
  return n ? packs.map((p) => (p.id === packId ? { ...p, name: n } : p)) : packs;
}

export function deletePack(packs: Pack[], packId: string): Pack[] {
  return packs.filter((p) => p.id !== packId);
}
