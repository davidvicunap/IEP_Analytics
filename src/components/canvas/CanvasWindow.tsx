"use client";

// One window on the canvas: a title bar (link group, company, kind, interval, actions) that
// drags the window, a corner that resizes it, and its body. Moves happen locally while the
// pointer is down and are saved once, on release. Keyboard: arrows on the title move it (Alt:
// resize; Shift: bigger steps), Delete closes it, Enter maximizes.
import Link from "next/link";
import { memo, useRef, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { GRID, INTERVALS, LINKS, MIN_SIZE, snap, type Interval, type Link as LinkGroup, type Rect, type ValuationView, type Widget, type WidgetKind } from "@/lib/canvas";
import TickerSearch from "../TickerSearch";
import { CloseIcon, CopyIcon, ExternalIcon, MaximizeIcon, MoreIcon, RestoreIcon } from "../icons";
import { InWindow, Skeleton } from "../ui";
import Popover from "./Popover";
import WidgetBody, { EDGE_TO_EDGE } from "./WidgetBody";

/** Link groups are told apart by number first; the colour is a second cue (chart series order). */
export const LINK_COLOR: Record<Exclude<LinkGroup, 0>, string> = { 1: "var(--series-1)", 2: "var(--series-2)", 3: "var(--series-5)" };

/** One stable set of actions for every window (so panning never re-renders them). */
export interface WindowActions {
  focus(id: string): void;
  rect(id: string, r: Rect): void;
  busy(b: boolean): void;
  close(id: string): void;
  duplicate(id: string): void;
  maximize(id: string): void;
  symbol(id: string, s: string): void;
  link(id: string, l: LinkGroup): void;
  interval(id: string, i: Interval): void;
  view(id: string, v: ValuationView): void;
  text(id: string, text: string): void;
  open(id: string, kind: WidgetKind): void;
}

const iconBtn = "grid h-11 w-11 shrink-0 place-items-center rounded-md text-muted hover:bg-panel-2 hover:text-fg sm:h-7 sm:w-7";

function CanvasWindow({
  widget: w,
  zoom,
  focused,
  maximized,
  display,
  mounted,
  actions,
}: {
  widget: Widget;
  zoom: number;
  focused: boolean;
  maximized: boolean;
  /** Where to draw it instead of its saved place (while maximized). */
  display?: Rect;
  /** False until the window first comes near the screen: heavy content loads then. */
  mounted: boolean;
  actions: WindowActions;
}) {
  const { t } = useI18n();
  const C = t.canvas;
  const kindName = C.kinds[w.kind].name;
  const [live, setLiveState] = useState<Rect | null>(null);
  // The latest drag position, also in a ref: a release can arrive before React re-renders.
  const liveRef = useRef<Rect | null>(null);
  const setLive = (r: Rect | null) => {
    liveRef.current = r;
    setLiveState(r);
  };
  const drag = useRef<{ px: number; py: number; r: Rect; mode: "move" | "resize" } | null>(null);
  const [menu, setMenu] = useState<null | "symbol" | "link" | "more">(null);
  const r = display ?? live ?? w;

  const begin = (e: React.PointerEvent, mode: "move" | "resize") => {
    if (e.button !== 0 || maximized) return;
    if (mode === "move" && (e.target as HTMLElement).closest("[data-nodrag]")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, r: { x: w.x, y: w.y, w: w.w, h: w.h }, mode };
    actions.focus(w.id);
    actions.busy(true);
  };
  const moveTo = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.px) / zoom;
    const dy = (e.clientY - d.py) / zoom;
    setLive(
      d.mode === "move"
        ? { ...d.r, x: snap(d.r.x + dx), y: snap(d.r.y + dy) }
        : { ...d.r, w: Math.max(MIN_SIZE.w, snap(d.r.w + dx)), h: Math.max(MIN_SIZE.h, snap(d.r.h + dy)) },
    );
  };
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    actions.busy(false);
    if (liveRef.current) actions.rect(w.id, liveRef.current);
    setLive(null);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? GRID * 8 : GRID;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (arrows[e.key] && !maximized) {
      e.preventDefault();
      const [dx, dy] = arrows[e.key];
      actions.rect(w.id, e.altKey ? { x: w.x, y: w.y, w: Math.max(MIN_SIZE.w, w.w + dx), h: Math.max(MIN_SIZE.h, w.h + dy) } : { x: w.x + dx, y: w.y + dy, w: w.w, h: w.h });
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      actions.close(w.id);
    } else if (e.key === "Enter") {
      e.preventDefault();
      actions.maximize(w.id);
    }
  };

  const symbolLabel = w.kind === "note" ? null : w.symbol;
  // The title bar keeps its size on screen whatever the canvas zoom (within 0.5×–2×), so its
  // buttons stay easy to hit; the content zooms with the canvas.
  const chrome = Math.min(2, Math.max(0.5, 1 / zoom));
  return (
    <section
      data-window={w.id}
      aria-label={symbolLabel ? fill(C.window, { k: kindName, s: symbolLabel }) : kindName}
      onPointerDownCapture={() => actions.focus(w.id)}
      className={`absolute flex flex-col rounded-lg border bg-panel ${focused || maximized ? "border-line-strong shadow-pop" : "border-line"}`}
      style={{ left: r.x, top: r.y, width: r.w, height: r.h, zIndex: maximized ? 100_000 : w.z }}
    >
      <div
        style={{ zoom: chrome }}
        className="flex min-h-11 shrink-0 cursor-grab touch-none select-none items-center gap-0.5 border-b border-line px-1 active:cursor-grabbing sm:min-h-9"
        onPointerDown={(e) => begin(e, "move")}
        onPointerMove={moveTo}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={(e) => {
          if (!(e.target as HTMLElement).closest("[data-nodrag]")) actions.maximize(w.id);
        }}
      >
        {w.kind !== "note" && (
          <div className="relative" data-nodrag>
            <button
              type="button"
              aria-label={`${C.linkTitle}: ${C.links[w.link]}`}
              title={C.linkTitle}
              aria-expanded={menu === "link"}
              onClick={() => setMenu(menu === "link" ? null : "link")}
              className={iconBtn}
            >
              <LinkSwatch link={w.link} />
            </button>
            <Popover open={menu === "link"} onClose={() => setMenu(null)} label={C.linkTitle} className="left-0 w-56 p-1.5">
              <p className="px-2 pb-1 pt-0.5 text-xs text-muted">{C.linkTitle}</p>
              {LINKS.map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={w.link === l}
                  onClick={() => {
                    actions.link(w.id, l);
                    setMenu(null);
                  }}
                  className={`flex min-h-11 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm hover:bg-panel-2 sm:min-h-9 ${w.link === l ? "font-medium" : ""}`}
                >
                  <LinkSwatch link={l} />
                  {C.links[l]}
                </button>
              ))}
            </Popover>
          </div>
        )}
        {symbolLabel && (
          <div className="relative" data-nodrag>
            <button
              type="button"
              title={C.changeSymbol}
              aria-label={`${C.changeSymbol}: ${symbolLabel}`}
              aria-expanded={menu === "symbol"}
              onClick={() => setMenu(menu === "symbol" ? null : "symbol")}
              className="num inline-flex h-11 items-center rounded-md px-2 text-[13px] font-semibold hover:bg-panel-2 sm:h-7"
            >
              {symbolLabel}
            </button>
            <Popover open={menu === "symbol"} onClose={() => setMenu(null)} label={C.changeSymbol} className="left-0 w-72 p-2">
              <TickerSearch
                autoFocus
                label={C.changeSymbol}
                onSelect={(s) => {
                  actions.symbol(w.id, s);
                  setMenu(null);
                }}
              />
            </Popover>
          </div>
        )}
        {/* The handle: drag it, or focus it and use the arrows. */}
        <button
          type="button"
          aria-label={`${kindName}. ${C.move}`}
          onKeyDown={onKey}
          onFocus={() => actions.focus(w.id)}
          className="h-11 min-w-0 flex-1 cursor-grab truncate px-1.5 text-left text-[13px] text-muted active:cursor-grabbing sm:h-7"
        >
          {kindName}
        </button>
        {(w.kind === "chart" || w.kind === "technicals") && (
          <select
            data-nodrag
            aria-label={C.interval}
            value={w.interval ?? "D"}
            onChange={(e) => actions.interval(w.id, e.target.value as Interval)}
            className="num h-11 shrink-0 rounded-md border border-line bg-panel px-1.5 text-xs sm:h-7"
          >
            {INTERVALS.map((i) => (
              <option key={i} value={i}>
                {C.intervals[i]}
              </option>
            ))}
          </select>
        )}
        <button type="button" data-nodrag aria-label={maximized ? C.restore : C.maximize} title={maximized ? C.restore : C.maximize} onClick={() => actions.maximize(w.id)} className={iconBtn}>
          {maximized ? <RestoreIcon size={15} /> : <MaximizeIcon size={15} />}
        </button>
        <div className="relative" data-nodrag>
          <button type="button" aria-label={C.more} title={C.more} aria-expanded={menu === "more"} onClick={() => setMenu(menu === "more" ? null : "more")} className={iconBtn}>
            <MoreIcon size={16} />
          </button>
          <Popover open={menu === "more"} onClose={() => setMenu(null)} label={C.more} className="right-0 w-60 p-1.5">
            <button
              type="button"
              onClick={() => {
                actions.duplicate(w.id);
                setMenu(null);
              }}
              className="flex min-h-11 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm hover:bg-panel-2 sm:min-h-9"
            >
              <CopyIcon size={16} className="text-muted" />
              {C.duplicateWindow}
            </button>
            {symbolLabel && (
              <Link
                href={`/stock/${encodeURIComponent(symbolLabel)}`}
                prefetch={false}
                className="flex min-h-11 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm hover:bg-panel-2 sm:min-h-9"
              >
                <ExternalIcon size={16} className="text-muted" />
                {fill(C.openStock, { s: symbolLabel })}
              </Link>
            )}
          </Popover>
        </div>
        <button type="button" data-nodrag aria-label={C.close} title={C.close} onClick={() => actions.close(w.id)} className={iconBtn}>
          <CloseIcon size={16} />
        </button>
      </div>
      <div className={`relative min-h-0 flex-1 ${EDGE_TO_EDGE.includes(w.kind) ? "overflow-hidden p-1.5" : w.kind === "note" ? "p-3" : "overflow-auto p-4"}`}>
        <InWindow.Provider value={true}>
          {mounted ? (
            <WidgetBody widget={w} onView={(v) => actions.view(w.id, v)} onText={(text) => actions.text(w.id, text)} onOpen={(k) => actions.open(w.id, k)} />
          ) : (
            <div className="space-y-3" aria-hidden="true">
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-32 w-full" />
            </div>
          )}
        </InWindow.Provider>
      </div>
      {!maximized && (
        <div
          aria-hidden="true"
          title={C.resize}
          className="absolute -bottom-px -right-px z-10 grid h-6 w-6 cursor-nwse-resize touch-none place-items-end p-1 text-muted [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
          onPointerDown={(e) => begin(e, "resize")}
          onPointerMove={moveTo}
          onPointerUp={end}
          onPointerCancel={end}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M9 1 1 9M9 5 5 9" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </section>
  );
}

/** A group's swatch: its number in ink (readable on any theme) beside its colour. */
export default memo(CanvasWindow);

export function LinkSwatch({ link }: { link: LinkGroup }) {
  if (link === 0) return <span className="h-2.5 w-2.5 rounded-[3px] border border-dashed border-line-strong" aria-hidden="true" />;
  return (
    <span className="inline-flex items-center gap-1" aria-hidden="true">
      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: LINK_COLOR[link] }} />
      <span className="num text-[11px] font-semibold text-fg">{link}</span>
    </span>
  );
}
