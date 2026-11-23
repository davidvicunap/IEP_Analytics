import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIZE,
  GAP,
  MAX_WIDGETS,
  addWidget,
  bounds,
  duplicateWidget,
  fitView,
  focusWidget,
  freeSpot,
  isNear,
  mergeCanvases,
  reveal,
  visibleWorld,
  newCanvas,
  parseCanvases,
  removeWidget,
  restoreWidget,
  setWidgetLink,
  setWidgetSymbol,
  updateWidget,
  zoomAt,
  type CanvasDoc,
  type Rect,
} from "./canvas";

const now = "2026-11-23T12:00:00.000Z";
let n = 0;
const ids = () => `w-${++n}`;
const blank = (): CanvasDoc => newCanvas({ id: "c-1", name: "Mi lienzo", template: "blank", symbol: "AAPL", ids }, now);
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("what a canvas may hold", () => {
  it("keeps only valid windows: known kinds, real tickers, sizes on the grid and within limits", () => {
    const [c] = parseCanvases([
      {
        id: "c-1",
        name: "  Semana   del 23 ",
        view: { x: 10, y: 20, zoom: 9 },
        widgets: [
          { id: "a", kind: "chart", x: 13, y: 5, w: 100, h: 99999, z: 1, symbol: "aapl", link: 1, interval: "1Y" },
          { id: "b", kind: "chart", x: 0, y: 0, symbol: "<script>", link: 0 },
          { id: "c", kind: "bogus", symbol: "MSFT" },
          { id: "a", kind: "news", symbol: "MSFT" }, // duplicate id
          { id: "d", kind: "note", symbol: "KO", link: 2, text: "x".repeat(900) },
          { id: "e", kind: "valuation", symbol: "KO", view: "nope" },
        ],
      },
      { id: "BAD ID", name: "x", widgets: [] },
    ]);
    expect(c.name).toBe("Semana del 23");
    expect(c.view.zoom).toBe(2);
    expect(c.widgets.map((w) => w.id)).toEqual(["a", "d", "e"]);
    const a = c.widgets[0];
    expect([a.x, a.y, a.w, a.h, a.symbol, a.interval]).toEqual([16, 8, 240, 4000, "AAPL", "D"]);
    const note = c.widgets[1];
    expect([note.symbol, note.link, note.text!.length]).toEqual([null, 0, 600]);
    expect(c.widgets[2].view).toBe("history");
  });

  it("a device's canvases join the account's without duplicates", () => {
    const acc = [blank()];
    const dev = [{ ...blank(), name: "otro nombre" }, { ...blank(), id: "c-2" }];
    expect(mergeCanvases(acc, dev).map((c) => [c.id, c.name])).toEqual([
      ["c-1", "Mi lienzo"],
      ["c-2", "Mi lienzo"],
    ]);
  });
});

describe("adding windows", () => {
  it("places each new window in a free spot near where you're looking, never on top of another", () => {
    let doc = blank();
    for (let i = 0; i < 8; i++) {
      const r = addWidget(doc, { id: ids(), kind: i % 2 ? "chart" : "financials", symbol: "MSFT", link: 0, near: { x: 400, y: 300 } }, now);
      expect(r.ok).toBe(true);
      if (r.ok) doc = r.doc;
    }
    for (const a of doc.widgets) for (const b of doc.widgets) if (a !== b) expect(overlap(a, b)).toBe(false);
    // The first one is centred on the point asked for.
    const first = doc.widgets[0];
    expect(Math.abs(first.x + first.w / 2 - 400)).toBeLessThanOrEqual(8);
  });

  it("refuses a window without a company, and more than the limit", () => {
    expect(addWidget(blank(), { id: "x", kind: "chart", symbol: "??", link: 0, near: { x: 0, y: 0 } }, now)).toEqual({ ok: false, reason: "symbol" });
    expect(addWidget(blank(), { id: "x", kind: "note", symbol: null, link: 1, near: { x: 0, y: 0 } }, now).ok).toBe(true);
    let doc = blank();
    for (let i = 0; i < MAX_WIDGETS; i++) {
      const r = addWidget(doc, { id: ids(), kind: "note", symbol: null, link: 0, near: { x: 0, y: 0 } }, now);
      if (r.ok) doc = r.doc;
    }
    expect(addWidget(doc, { id: "x", kind: "note", symbol: null, link: 0, near: { x: 0, y: 0 } }, now)).toEqual({ ok: false, reason: "full" });
  });

  it("a free spot keeps a gutter from its neighbours", () => {
    const taken = [{ x: 0, y: 0, w: 400, h: 300 }];
    const s = freeSpot(taken, 400, 300, { x: 200, y: 150 });
    const r = { ...s, w: 400, h: 300 };
    expect(overlap(r, { x: -GAP + 1, y: -GAP + 1, w: 400 + 2 * GAP - 2, h: 300 + 2 * GAP - 2 })).toBe(false);
  });
});

describe("new windows land where you can see them", () => {
  it("prefers a free spot on screen, and the view follows when there's none", () => {
    const taken = [{ x: 0, y: 0, w: 800, h: 600 }];
    const screen = { x: -100, y: -100, w: 1400, h: 900 };
    const s = freeSpot(taken, 300, 200, { x: 400, y: 300 }, screen);
    expect(s.x >= screen.x && s.y >= screen.y && s.x + 300 <= screen.x + screen.w && s.y + 200 <= screen.y + screen.h).toBe(true);
    expect(s.x).toBeGreaterThanOrEqual(800); // beside, not above
    const v = reveal({ x: 0, y: 0, zoom: 1 }, { x: 2000, y: -500, w: 300, h: 200 }, 1200, 800);
    const seen = visibleWorld(v, 1200, 800);
    expect(seen.x <= 2000 && seen.y <= -500 && seen.x + seen.w >= 2300 && seen.y + seen.h >= -300).toBe(true);
  });
});

describe("linked windows", () => {
  it("windows in a group follow one company; others keep theirs", () => {
    let doc = newCanvas({ id: "c", name: "x", template: "full", symbol: "aapl", ids }, now);
    const linked = doc.widgets.filter((w) => w.link === 1);
    expect(linked.length).toBe(doc.widgets.length - 1); // all but the note
    const chart = doc.widgets.find((w) => w.kind === "chart")!;
    doc = setWidgetLink(doc, doc.widgets.find((w) => w.kind === "news")!.id, 0, now);
    doc = setWidgetSymbol(doc, chart.id, "nvda", now);
    expect(doc.widgets.filter((w) => w.link === 1).every((w) => w.symbol === "NVDA")).toBe(true);
    expect(doc.widgets.find((w) => w.kind === "news")!.symbol).toBe("AAPL");
    // Joining group 1 shows its company; a new window in the group too.
    doc = setWidgetLink(doc, doc.widgets.find((w) => w.kind === "news")!.id, 1, now);
    expect(doc.widgets.find((w) => w.kind === "news")!.symbol).toBe("NVDA");
    const r = addWidget(doc, { id: "new", kind: "insiders", symbol: "KO", link: 1, near: { x: 0, y: 0 } }, now);
    expect(r.ok && r.widget.symbol).toBe("NVDA");
  });
});

describe("editing", () => {
  it("moves and resizes on the grid, never below the minimum size", () => {
    const r = addWidget(blank(), { id: "a", kind: "chart", symbol: "AAPL", link: 0, near: { x: 0, y: 0 } }, now);
    if (!r.ok) throw new Error();
    const doc = updateWidget(r.doc, "a", { x: 101, y: -3, w: 10, h: 333 }, now);
    expect(doc.widgets[0]).toMatchObject({ x: 104, y: 0, w: 240, h: 336 });
  });

  it("brings a window to the front with compact stacking numbers", () => {
    let doc = newCanvas({ id: "c", name: "x", template: "technical", symbol: "AAPL", ids }, now);
    const first = doc.widgets[0].id;
    doc = focusWidget(doc, first);
    expect(doc.widgets.find((w) => w.id === first)!.z).toBe(doc.widgets.length);
    expect(new Set(doc.widgets.map((w) => w.z)).size).toBe(doc.widgets.length);
  });

  it("closing can be undone; duplicating lands next to the original", () => {
    const base = newCanvas({ id: "c", name: "x", template: "full", symbol: "AAPL", ids }, now);
    const target = base.widgets[0];
    const { doc, removed } = removeWidget(base, target.id, now);
    expect(doc.widgets.length).toBe(base.widgets.length - 1);
    expect(restoreWidget(doc, removed!, now).widgets.length).toBe(base.widgets.length);
    const d = duplicateWidget(base, target.id, "copy", now);
    expect(d.ok && d.widget.symbol).toBe("AAPL");
    if (d.ok) for (const w of base.widgets) expect(overlap(d.widget, w)).toBe(false);
  });
});

describe("pan and zoom", () => {
  it("zooming keeps the point under the cursor in place", () => {
    const v = { x: 100, y: 50, zoom: 1 };
    const z = zoomAt(v, 1.5, 300, 200);
    const world = (sx: number, view: typeof v) => (sx - view.x) / view.zoom;
    expect(world(300, z)).toBeCloseTo(world(300, v));
    expect(zoomAt(v, 100, 0, 0).zoom).toBe(2);
    expect(zoomAt(v, 0.001, 0, 0).zoom).toBe(0.2);
  });

  it("fit shows every window, never zooming in past 100 %", () => {
    const doc = newCanvas({ id: "c", name: "x", template: "full", symbol: "AAPL", ids }, now);
    const v = fitView(doc.widgets, 1200, 800);
    const b = bounds(doc.widgets)!;
    expect(b.x * v.zoom + v.x).toBeGreaterThanOrEqual(31);
    expect((b.x + b.w) * v.zoom + v.x).toBeLessThanOrEqual(1200 - 31);
    expect(fitView([{ x: 0, y: 0, w: 100, h: 100 }], 1200, 800).zoom).toBe(1);
    expect(isNear({ x: 5000, y: 5000, ...DEFAULT_SIZE.chart }, { x: 0, y: 0, zoom: 1 }, 1200, 800)).toBe(false);
  });
});
