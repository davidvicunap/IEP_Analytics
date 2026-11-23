"use client";

// The infinite surface: pans by dragging the background (or scrolling), zooms with Ctrl/⌘ +
// wheel or a pinch, around the pointer. Windows load their content the first time they come
// near the screen. While something is being dragged, embedded frames stop taking the pointer
// (data-busy) so a drag never gets lost inside a chart.
import { useEffect, useRef } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { bounds, isNear, visibleWorld, zoomAt, type CanvasDoc, type Rect, type View } from "@/lib/canvas";
import { isTypingTarget } from "../Header";

export default function Surface({
  doc,
  view,
  setView,
  size,
  surfaceRef,
  locked,
  busy,
  setBusy,
  onKey,
  children,
}: {
  doc: CanvasDoc;
  view: View;
  setView: (v: View) => void;
  size: { w: number; h: number };
  surfaceRef: React.RefObject<HTMLDivElement | null>;
  /** A window is maximized: the surface stays put. */
  locked: boolean;
  busy: boolean;
  setBusy: (b: boolean) => void;
  /** Canvas-wide shortcuts (zoom, fit, add, restore). Returns true when handled. */
  onKey: (key: string) => boolean;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const C = t.canvas;
  const viewRef = useRef(view);
  viewRef.current = view;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  // Wheel: Ctrl/⌘ zooms around the pointer; otherwise the background pans. Over a window's
  // content the wheel scrolls that content as usual.
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (lockedRef.current) return;
      const overWindow = (e.target as HTMLElement).closest("[data-window]");
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setView(zoomAt(viewRef.current, Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top));
      } else if (!overWindow) {
        e.preventDefault();
        const v = viewRef.current;
        setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [surfaceRef, setView]);

  // Background drag pans; two fingers pinch-zoom.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ view: View; x: number; y: number; dist?: number; mid?: { x: number; y: number } } | null>(null);
  const isBackground = (e: React.PointerEvent) => !(e.target as HTMLElement).closest("[data-window],[data-nodrag]");
  const local = (e: { clientX: number; clientY: number }) => {
    const r = surfaceRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const startGesture = () => {
    const pts = [...pointers.current.values()];
    if (pts.length === 1) gesture.current = { view: viewRef.current, x: pts[0].x, y: pts[0].y };
    else if (pts.length >= 2) {
      const [a, b] = pts;
      gesture.current = { view: viewRef.current, x: 0, y: 0, dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    }
  };
  const down = (e: React.PointerEvent) => {
    if (lockedRef.current || !isBackground(e) || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    startGesture();
    setBusy(true);
  };
  const move = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, local(e));
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    if (pts.length >= 2 && g.dist && g.mid) {
      const [a, b] = pts;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const z = zoomAt(g.view, dist / g.dist, g.mid.x, g.mid.y);
      setView({ ...z, x: z.x + (mid.x - g.mid.x), y: z.y + (mid.y - g.mid.y) });
    } else if (pts.length === 1) {
      setView({ ...g.view, x: g.view.x + (pts[0].x - g.x), y: g.view.y + (pts[0].y - g.y) });
    }
  };
  const up = (e: React.PointerEvent) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (pointers.current.size > 0) startGesture();
    else {
      gesture.current = null;
      setBusy(false);
    }
  };

  const keyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.nativeEvent)) return;
    // Shortcuts belong to the canvas, not to a focused button inside a window's title.
    const inWindow = (e.target as HTMLElement).closest("[data-window]");
    if (inWindow && e.key !== "Escape") return;
    if (onKey(e.key)) e.preventDefault();
  };

  // The dot grid moves and scales with the canvas, so you can tell you're moving.
  const step = 24 * view.zoom;
  return (
    <div
      ref={surfaceRef}
      tabIndex={0}
      role="region"
      aria-roledescription="canvas"
      aria-label={fill(C.surface, { n: doc.name, w: doc.widgets.length })}
      data-busy={busy || undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={keyDown}
      className="relative h-full w-full touch-none overflow-hidden bg-bg outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      style={{
        backgroundImage: "radial-gradient(var(--border-strong) 1px, transparent 1.2px)",
        backgroundSize: `${step}px ${step}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
        cursor: busy ? "grabbing" : "grab",
      }}
    >
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
        {children}
      </div>
    </div>
  );
}

/** Which windows have come near the screen at least once (their content stays loaded after). */
export function useMounted(doc: CanvasDoc, view: View, size: { w: number; h: number }) {
  const seen = useRef(new Set<string>());
  if (size.w > 0) for (const w of doc.widgets) if (isNear(w, view, size.w, size.h)) seen.current.add(w.id);
  return seen.current;
}

/** A map of the whole canvas with the part on screen outlined; press or drag to go there. */
export function Minimap({ widgets, view, size, focused, setView, label }: { widgets: (Rect & { id: string })[]; view: View; size: { w: number; h: number }; focused: string | null; setView: (v: View) => void; label: string }) {
  const W = 176;
  const H = 112;
  const vis = visibleWorld(view, size.w, size.h);
  const b = bounds([...widgets, vis])!;
  const k = Math.min((W - 8) / b.w, (H - 8) / b.h);
  const ox = (W - b.w * k) / 2;
  const oy = (H - b.h * k) / 2;
  const go = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const wx = b.x + (e.clientX - r.left - ox) / k;
    const wy = b.y + (e.clientY - r.top - oy) / k;
    setView({ ...view, x: size.w / 2 - wx * view.zoom, y: size.h / 2 - wy * view.zoom });
  };
  return (
    <div
      aria-hidden="true"
      title={label}
      data-nodrag
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        go(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons) go(e);
      }}
      className="absolute bottom-3 right-3 z-20 hidden cursor-pointer rounded-md border border-line bg-panel sm:block"
      style={{ width: W, height: H }}
    >
      {widgets.map((w) => (
        <span
          key={w.id}
          className={`absolute rounded-[2px] ${w.id === focused ? "bg-fg/60" : "bg-fg/20"}`}
          style={{ left: ox + (w.x - b.x) * k, top: oy + (w.y - b.y) * k, width: Math.max(2, w.w * k), height: Math.max(2, w.h * k) }}
        />
      ))}
      <span className="absolute rounded-[2px] border border-fg/70" style={{ left: ox + (vis.x - b.x) * k, top: oy + (vis.y - b.y) * k, width: vis.w * k, height: vis.h * k }} />
    </div>
  );
}
