// Trading Canvas: an infinite surface of windows (TradingView charts, statements, valuation,
// news, notes…) laid out for one analysis. This module is the model, pure and tested: what a
// canvas holds, how it's validated (it syncs to the account), where a new window goes, symbol
// linking between windows, and the pan/zoom maths. The views live in components/canvas.
import { SYMBOL } from "./watchlistShared";

export const WIDGET_KINDS = ["chart", "technicals", "news", "glance", "plan", "financials", "ratios", "quarter", "valuation", "filings", "insiders", "note"] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];
const isKind = (v: unknown): v is WidgetKind => typeof v === "string" && (WIDGET_KINDS as readonly string[]).includes(v);

/** The menu's groups: market data (TradingView), the company (SEC), its price, and your own work. */
export const KIND_GROUPS: { key: "market" | "company" | "value" | "yours"; kinds: WidgetKind[] }[] = [
  { key: "market", kinds: ["chart", "technicals", "news"] },
  { key: "company", kinds: ["glance", "financials", "ratios", "quarter", "filings", "insiders"] },
  { key: "value", kinds: ["valuation"] },
  { key: "yours", kinds: ["plan", "note"] },
];

/** Chart intervals offered (TradingView's codes). */
export const INTERVALS = ["5", "15", "60", "240", "D", "W", "M"] as const;
export type Interval = (typeof INTERVALS)[number];
export const VALUATION_VIEWS = ["history", "comps", "expectations"] as const;
export type ValuationView = (typeof VALUATION_VIEWS)[number];

/** Symbol link groups: windows in the same group always show the same company. 0 = not linked. */
export const LINKS = [0, 1, 2, 3] as const;
export type Link = (typeof LINKS)[number];

export interface Widget {
  id: string;
  kind: WidgetKind;
  /** World coordinates (px at 100 % zoom). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Stacking order: higher is in front. */
  z: number;
  symbol: string | null; // null only for notes
  link: Link;
  interval?: Interval; // chart, technicals
  view?: ValuationView; // valuation
  text?: string; // note
}

/** Screen = world × zoom + (x, y). */
export interface View {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasDoc {
  id: string;
  name: string;
  widgets: Widget[];
  view: View;
  updatedAt: string;
}

export const MAX_CANVASES = 10;
export const MAX_WIDGETS = 30;
export const MAX_NOTE = 600;
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2;
export const GRID = 8;
export const GAP = 16;
const LIMIT = 100_000; // no window lives further than this from the origin

export const DEFAULT_SIZE: Record<WidgetKind, { w: number; h: number }> = {
  chart: { w: 760, h: 464 },
  technicals: { w: 376, h: 464 },
  news: { w: 400, h: 520 },
  glance: { w: 400, h: 464 },
  plan: { w: 400, h: 360 },
  financials: { w: 760, h: 520 },
  ratios: { w: 560, h: 480 },
  quarter: { w: 480, h: 440 },
  valuation: { w: 760, h: 560 },
  filings: { w: 560, h: 480 },
  insiders: { w: 520, h: 440 },
  note: { w: 320, h: 240 },
};
export const MIN_SIZE = { w: 240, h: 160 };

export const snap = (n: number) => Math.round(n / GRID) * GRID || 0; // never -0
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const finite = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

export function cleanSymbol(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toUpperCase();
  return SYMBOL.test(s) ? s : null;
}
export const cleanName = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 40) : "");

// ---- Validation (everything that comes from storage or the account goes through here) --------

function parseWidget(raw: unknown): Widget | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && /^[a-z0-9-]{1,40}$/.test(r.id) ? r.id : null;
  if (!id || !isKind(r.kind)) return null;
  const kind = r.kind;
  const symbol = kind === "note" ? null : cleanSymbol(r.symbol);
  if (kind !== "note" && !symbol) return null;
  const w: Widget = {
    id,
    kind,
    x: snap(clamp(finite(r.x, 0), -LIMIT, LIMIT)),
    y: snap(clamp(finite(r.y, 0), -LIMIT, LIMIT)),
    w: snap(clamp(finite(r.w, DEFAULT_SIZE[kind].w), MIN_SIZE.w, 4000)),
    h: snap(clamp(finite(r.h, DEFAULT_SIZE[kind].h), MIN_SIZE.h, 4000)),
    z: Math.round(clamp(finite(r.z, 0), 0, 1e6)),
    symbol,
    link: kind === "note" ? 0 : ((LINKS as readonly number[]).includes(r.link as number) ? (r.link as Link) : 0),
  };
  if (kind === "chart" || kind === "technicals") w.interval = (INTERVALS as readonly string[]).includes(r.interval as string) ? (r.interval as Interval) : "D";
  if (kind === "valuation") w.view = (VALUATION_VIEWS as readonly string[]).includes(r.view as string) ? (r.view as ValuationView) : "history";
  if (kind === "note") w.text = typeof r.text === "string" ? r.text.slice(0, MAX_NOTE) : "";
  return w;
}

export function parseView(raw: unknown): View {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { x: clamp(finite(r.x, 24), -LIMIT * 2, LIMIT * 2), y: clamp(finite(r.y, 24), -LIMIT * 2, LIMIT * 2), zoom: clamp(finite(r.zoom, 1), MIN_ZOOM, MAX_ZOOM) };
}

export function parseCanvas(raw: unknown): CanvasDoc | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && /^[a-z0-9-]{1,40}$/.test(r.id) ? r.id : null;
  const name = cleanName(r.name);
  if (!id || !name) return null;
  const seen = new Set<string>();
  const widgets = (Array.isArray(r.widgets) ? r.widgets : [])
    .map(parseWidget)
    .filter((w): w is Widget => !!w && !seen.has(w.id) && (seen.add(w.id), true))
    .slice(0, MAX_WIDGETS);
  const updatedAt = typeof r.updatedAt === "string" && !Number.isNaN(Date.parse(r.updatedAt)) ? r.updatedAt : new Date(0).toISOString();
  return { id, name, widgets, view: parseView(r.view), updatedAt };
}

export function parseCanvases(raw: unknown): CanvasDoc[] {
  if (!Array.isArray(raw)) return [];
  const out: CanvasDoc[] = [];
  for (const item of raw) {
    const c = parseCanvas(item);
    if (c && !out.some((o) => o.id === c.id)) out.push(c);
    if (out.length >= MAX_CANVASES) break;
  }
  return out;
}

/** A device's canvases joining the account's: the account's first, the device adds what's missing. */
export function mergeCanvases(account: unknown, device: unknown): CanvasDoc[] {
  const mine = parseCanvases(account);
  const extra = parseCanvases(device).filter((d) => !mine.some((m) => m.id === d.id));
  return [...mine, ...extra].slice(0, MAX_CANVASES);
}

// ---- Geometry ----------------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
const overlaps = (a: Rect, b: Rect, gap = 0) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

export function bounds(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
}

/**
 * Where a new window of size (w, h) goes: the free spot nearest `near` (its centre), scanning
 * rings of grid positions outwards, keeping a gutter from every other window. With `within`
 * (the part of the canvas on screen) a spot that fits on screen wins over a nearer one that doesn't.
 */
export function freeSpot(widgets: Rect[], w: number, h: number, near: { x: number; y: number }, within?: Rect): { x: number; y: number } {
  if (within) {
    const inside = (x: number, y: number) => x >= within.x && y >= within.y && x + w <= within.x + within.w && y + h <= within.y + within.h;
    const spot = search(widgets, w, h, near, inside, 40);
    if (spot) return spot;
  }
  return search(widgets, w, h, near, () => true, 80) ?? (() => {
    const b = bounds(widgets)!;
    return { x: snap(b.x + b.w + GAP), y: snap(b.y) };
  })();
}

function search(widgets: Rect[], w: number, h: number, near: { x: number; y: number }, ok: (x: number, y: number) => boolean, rings: number): { x: number; y: number } | null {
  const start = { x: snap(near.x - w / 2), y: snap(near.y - h / 2) };
  const step = GAP * 2;
  const free = (x: number, y: number) => ok(x, y) && !widgets.some((o) => overlaps({ x, y, w, h }, o, GAP - 1));
  if (free(start.x, start.y)) return start;
  for (let ring = 1; ring <= rings; ring++) {
    const candidates: { x: number; y: number; d: number }[] = [];
    for (let i = -ring; i <= ring; i++) {
      for (const [dx, dy] of [
        [i, -ring],
        [i, ring],
        [-ring, i],
        [ring, i],
      ]) {
        const x = start.x + dx * step;
        const y = start.y + dy * step;
        candidates.push({ x, y, d: Math.hypot(dx, dy * 1.6) }); // side by side before stacked
      }
    }
    candidates.sort((a, b) => a.d - b.d);
    const hit = candidates.find((c) => free(c.x, c.y));
    if (hit) return { x: hit.x, y: hit.y };
  }
  return null;
}

// ---- Edits (each returns a new canvas) ---------------------------------------------------------

const touch = (doc: CanvasDoc, widgets: Widget[], now: string): CanvasDoc => ({ ...doc, widgets, updatedAt: now });
const topZ = (widgets: Widget[]) => widgets.reduce((m, w) => Math.max(m, w.z), 0);

export type AddResult = { ok: true; doc: CanvasDoc; widget: Widget } | { ok: false; reason: "full" | "symbol" };

export function addWidget(doc: CanvasDoc, input: { id: string; kind: WidgetKind; symbol: string | null; link: Link; near: { x: number; y: number }; within?: Rect }, now: string): AddResult {
  if (doc.widgets.length >= MAX_WIDGETS) return { ok: false, reason: "full" };
  const symbol = input.kind === "note" ? null : cleanSymbol(input.symbol);
  if (input.kind !== "note" && !symbol) return { ok: false, reason: "symbol" };
  const link: Link = input.kind === "note" ? 0 : input.link;
  // Joining a group shows the group's company.
  const groupSymbol = link ? doc.widgets.find((w) => w.link === link)?.symbol : null;
  const size = DEFAULT_SIZE[input.kind];
  const spot = freeSpot(doc.widgets, size.w, size.h, input.near, input.within);
  const widget = parseWidget({ id: input.id, kind: input.kind, ...spot, ...size, z: topZ(doc.widgets) + 1, symbol: groupSymbol ?? symbol, link })!;
  return { ok: true, doc: touch(doc, [...doc.widgets, widget], now), widget };
}

export function updateWidget(doc: CanvasDoc, id: string, patch: Partial<Pick<Widget, "x" | "y" | "w" | "h" | "interval" | "view" | "text">>, now: string): CanvasDoc {
  return touch(
    doc,
    doc.widgets.map((w) => (w.id === id ? (parseWidget({ ...w, ...patch }) ?? w) : w)),
    now,
  );
}

/** Brings a window to the front (stacking numbers are compacted so they never grow without end). */
export function focusWidget(doc: CanvasDoc, id: string): CanvasDoc {
  const target = doc.widgets.find((w) => w.id === id);
  if (!target || target.z === topZ(doc.widgets)) return doc;
  const order = [...doc.widgets].sort((a, b) => a.z - b.z).filter((w) => w.id !== id);
  const z = new Map([...order, target].map((w, i) => [w.id, i + 1]));
  return { ...doc, widgets: doc.widgets.map((w) => ({ ...w, z: z.get(w.id)! })) };
}

export function removeWidget(doc: CanvasDoc, id: string, now: string): { doc: CanvasDoc; removed: Widget | null } {
  const removed = doc.widgets.find((w) => w.id === id) ?? null;
  return { doc: removed ? touch(doc, doc.widgets.filter((w) => w.id !== id), now) : doc, removed };
}

/** Puts a closed window back (undo), unless the canvas filled up meanwhile. */
export function restoreWidget(doc: CanvasDoc, widget: Widget, now: string): CanvasDoc {
  if (doc.widgets.length >= MAX_WIDGETS || doc.widgets.some((w) => w.id === widget.id)) return doc;
  return touch(doc, [...doc.widgets, { ...widget, z: topZ(doc.widgets) + 1 }], now);
}

export function duplicateWidget(doc: CanvasDoc, id: string, newId: string, now: string): AddResult {
  const src = doc.widgets.find((w) => w.id === id);
  if (!src) return { ok: false, reason: "symbol" };
  if (doc.widgets.length >= MAX_WIDGETS) return { ok: false, reason: "full" };
  const spot = freeSpot(doc.widgets, src.w, src.h, { x: src.x + src.w * 1.5 + GAP, y: src.y + src.h / 2 });
  const widget: Widget = { ...src, id: newId, ...spot, z: topZ(doc.widgets) + 1 };
  return { ok: true, doc: touch(doc, [...doc.widgets, widget], now), widget };
}

/** A window's company: every window in its link group follows. */
export function setWidgetSymbol(doc: CanvasDoc, id: string, raw: string, now: string): CanvasDoc {
  const symbol = cleanSymbol(raw);
  const target = doc.widgets.find((w) => w.id === id);
  if (!symbol || !target || target.kind === "note") return doc;
  return touch(
    doc,
    doc.widgets.map((w) => (w.id === id || (target.link !== 0 && w.link === target.link && w.kind !== "note") ? { ...w, symbol } : w)),
    now,
  );
}

/** Joins (or leaves, with 0) a link group; joining shows the group's company. */
export function setWidgetLink(doc: CanvasDoc, id: string, link: Link, now: string): CanvasDoc {
  const target = doc.widgets.find((w) => w.id === id);
  if (!target || target.kind === "note") return doc;
  const groupSymbol = link ? doc.widgets.find((w) => w.id !== id && w.link === link)?.symbol : null;
  return touch(
    doc,
    doc.widgets.map((w) => (w.id === id ? { ...w, link, symbol: groupSymbol ?? w.symbol } : w)),
    now,
  );
}

// ---- Pan and zoom ------------------------------------------------------------------------------

export const clampZoom = (z: number) => clamp(z, MIN_ZOOM, MAX_ZOOM);

/** Zooms by `factor` keeping the screen point (px, py) over the same spot of the canvas. */
export function zoomAt(view: View, factor: number, px: number, py: number): View {
  const zoom = clampZoom(view.zoom * factor);
  const k = zoom / view.zoom;
  return { zoom, x: px - (px - view.x) * k, y: py - (py - view.y) * k };
}

/** The view that shows every window in a viewport of (width × height), never above 100 %. */
export function fitView(widgets: Rect[], width: number, height: number, padding = 32): View {
  const b = bounds(widgets);
  if (!b || width <= 0 || height <= 0) return { x: padding, y: padding, zoom: 1 };
  const zoom = clampZoom(Math.min(1, (width - padding * 2) / b.w, (height - padding * 2) / b.h));
  return { zoom, x: (width - b.w * zoom) / 2 - b.x * zoom, y: (height - b.h * zoom) / 2 - b.y * zoom };
}

/** The view moved just enough to show `r` whole (centred when it's bigger than the screen). */
export function reveal(view: View, r: Rect, width: number, height: number, margin = 24): View {
  const v = visibleWorld(view, width, height);
  const m = margin / view.zoom;
  let x = v.x;
  let y = v.y;
  if (r.w + 2 * m > v.w) x = r.x + r.w / 2 - v.w / 2;
  else if (r.x - m < v.x) x = r.x - m;
  else if (r.x + r.w + m > v.x + v.w) x = r.x + r.w + m - v.w;
  if (r.h + 2 * m > v.h) y = r.y - m;
  else if (r.y - m < v.y) y = r.y - m;
  else if (r.y + r.h + m > v.y + v.h) y = r.y + r.h + m - v.h;
  return { zoom: view.zoom, x: -x * view.zoom, y: -y * view.zoom };
}

/** The canvas area (world coordinates) a viewport shows. */
export const visibleWorld = (view: View, width: number, height: number): Rect => ({ x: -view.x / view.zoom, y: -view.y / view.zoom, w: width / view.zoom, h: height / view.zoom });

/** True when a window is on screen or close to it (heavy windows load only then). */
export const isNear = (w: Rect, view: View, width: number, height: number, margin = 400) => {
  const v = visibleWorld(view, width, height);
  return overlaps(w, { x: v.x - margin, y: v.y - margin, w: v.w + margin * 2, h: v.h + margin * 2 });
};

// ---- New canvases ------------------------------------------------------------------------------

export const TEMPLATES = ["full", "technical", "fundamental", "blank"] as const;
export type Template = (typeof TEMPLATES)[number];

type Slot = Omit<Widget, "id" | "z" | "symbol" | "link">;
const slot = (kind: WidgetKind, x: number, y: number, extra: Partial<Slot> = {}): Slot => ({ kind, x, y, ...DEFAULT_SIZE[kind], ...extra });

const LAYOUTS: Record<Exclude<Template, "blank">, Slot[]> = {
  // The chart first, its technical reading beside it, the news on the right; below, the business
  // (statements and valuation), what the data says at a glance and your own plan and note.
  full: [
    slot("chart", 0, 0),
    slot("technicals", 776, 0),
    slot("news", 1168, 0, { h: 464 }),
    slot("financials", 0, 480),
    slot("valuation", 776, 480, { w: 792 }),
    slot("glance", 0, 1016, { w: 376, h: 440 }),
    slot("plan", 392, 1016, { w: 368, h: 440 }),
    slot("note", 776, 1056, { w: 792, h: 400 }),
  ],
  // The same company on four timeframes, with the technical gauge.
  technical: [
    slot("chart", 0, 0, { interval: "15", w: 640, h: 400 }),
    slot("chart", 656, 0, { interval: "60", w: 640, h: 400 }),
    slot("technicals", 1312, 0, { h: 816 }),
    slot("chart", 0, 416, { interval: "D", w: 640, h: 400 }),
    slot("chart", 656, 416, { interval: "W", w: 640, h: 400 }),
  ],
  // The business: verdict, statements, ratios, the latest quarter, filings, insiders, valuation.
  fundamental: [
    slot("glance", 0, 0),
    slot("financials", 416, 0),
    slot("valuation", 1192, 0),
    slot("ratios", 0, 536, { w: 400 }),
    slot("quarter", 416, 536, { w: 376 }),
    slot("filings", 808, 536, { w: 376 }),
    slot("insiders", 1200, 536),
  ],
};

export function newCanvas(input: { id: string; name: string; template: Template; symbol: string; ids: () => string }, now: string): CanvasDoc {
  const symbol = cleanSymbol(input.symbol) ?? "AAPL";
  const slots = input.template === "blank" ? [] : LAYOUTS[input.template];
  const widgets = slots.map((s, i) => parseWidget({ ...s, id: input.ids(), z: i + 1, symbol: s.kind === "note" ? null : symbol, link: s.kind === "note" ? 0 : 1 })!);
  return { id: input.id, name: cleanName(input.name) || "Canvas", widgets, view: { x: 24, y: 24, zoom: 1 }, updatedAt: now };
}
