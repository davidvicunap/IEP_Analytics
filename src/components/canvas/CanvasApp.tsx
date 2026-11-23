"use client";

// Trading Canvas: pick or start a canvas, then work on it. The canvas being edited lives in this
// component's state (so drags and pans stay smooth) and is saved a moment after each change, to
// this browser and, through the settings sync, to the account.
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import {
  GAP,
  KIND_GROUPS,
  LINKS,
  MAX_CANVASES,
  MAX_WIDGETS,
  TEMPLATES,
  addWidget,
  bounds,
  duplicateWidget,
  fitView,
  focusWidget,
  newCanvas,
  removeWidget,
  restoreWidget,
  reveal,
  setWidgetLink,
  setWidgetSymbol,
  updateWidget,
  visibleWorld,
  zoomAt,
  type CanvasDoc,
  type Link as LinkGroup,
  type Rect,
  type Template,
  type View,
  type WidgetKind,
} from "@/lib/canvas";
import { deleteCanvas, newId, saveCanvas, useCanvases } from "@/lib/canvasClient";
import { useSyncStatus } from "@/lib/prefsSync";
import { useHydrated, useWatchlist } from "@/lib/watchlist";
import TickerSearch from "../TickerSearch";
import { CanvasIcon, ChevronDownIcon, FitIcon, MinusIcon, PlusIcon } from "../icons";
import { Skeleton, StatusMessage, buttonClass, toast } from "../ui";
import CanvasWindow, { LinkSwatch, type WindowActions } from "./CanvasWindow";
import Popover from "./Popover";
import Surface, { Minimap, useMounted } from "./Surface";

const nowIso = () => new Date().toISOString();
const iconBtn = "grid h-11 w-11 place-items-center rounded-md text-muted hover:bg-panel-2 hover:text-fg sm:h-8 sm:w-8";
/** Canvases created in this visit open zoomed to show their windows. */
const fitOnOpen = new Set<string>();

export default function CanvasApp() {
  const hydrated = useHydrated();
  const canvases = useCanvases();
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("c");
  const current = canvases.find((c) => c.id === id) ?? canvases[0] ?? null;
  if (!hydrated) return <WorkspaceSkeleton />;
  if (params.get("new") === "1" || !current) {
    return (
      <Start
        existing={canvases}
        onCreated={(doc) => {
          fitOnOpen.add(doc.id);
          router.replace(`/canvas?c=${doc.id}`);
        }}
        onBack={current ? () => router.replace(`/canvas?c=${current.id}`) : undefined}
      />
    );
  }
  return <Workspace key={current.id} stored={current} all={canvases} select={(cid) => router.replace(cid ? `/canvas?c=${cid}` : "/canvas")} startNew={() => router.push("/canvas?new=1")} />;
}

function WorkspaceSkeleton() {
  return (
    <div className="flex h-full flex-col" aria-hidden="true">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="grid flex-1 grid-cols-3 gap-4 p-6">
        <Skeleton className="col-span-2 h-72" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}

// ---- Start a canvas ----------------------------------------------------------------------------

function Start({ existing, onCreated, onBack }: { existing: CanvasDoc[]; onCreated: (doc: CanvasDoc) => void; onBack?: () => void }) {
  const { t } = useI18n();
  const C = t.canvas;
  const { list } = useWatchlist();
  const [symbol, setSymbol] = useState<string>(list[0] ?? "AAPL");
  const [template, setTemplate] = useState<Template>("full");
  const full = existing.length >= MAX_CANVASES;
  const create = () => {
    const name = template === "blank" ? fill(C.blankName, { n: existing.length + 1 }) : fill(C.defaultName, { s: symbol, t: C.templates[template].name });
    const doc = newCanvas({ id: newId("c"), name, template, symbol, ids: () => newId("w") }, nowIso());
    saveCanvas(doc);
    onCreated(doc);
  };
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-[30px] font-semibold leading-tight sm:text-[38px]">{C.title}</h1>
        <p className="mt-2 max-w-[68ch] text-[15px] leading-relaxed text-muted">{C.intro}</p>

        <section aria-labelledby="canvas-start" className="mt-10 space-y-6">
          <h2 id="canvas-start" className="section-title">
            {C.startTitle}
          </h2>
          <div>
            <p className="control-label mb-1.5">{C.symbol}</p>
            <div className="flex flex-wrap items-center gap-3">
              <span className="num inline-flex h-11 items-center rounded-lg border border-line-strong bg-panel px-3 text-sm font-semibold" data-testid="start-symbol">
                {symbol}
              </span>
              <div className="w-full max-w-xs">
                <TickerSearch label={C.symbol} onSelect={setSymbol} />
              </div>
            </div>
          </div>
          <div role="radiogroup" aria-label={C.startTitle} className="grid gap-3 sm:grid-cols-2">
            {TEMPLATES.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={template === k}
                onClick={() => setTemplate(k)}
                className={`rounded-lg border bg-panel p-4 text-left transition-colors ${template === k ? "border-fg" : "border-line hover:border-line-strong"}`}
              >
                <TemplateThumb template={k} />
                <span className="mt-3 block text-sm font-semibold">{C.templates[k].name}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-muted">{C.templates[k].desc}</span>
              </button>
            ))}
          </div>
          {full && <StatusMessage tone="warn">{fill(C.tooMany, { n: MAX_CANVASES })}</StatusMessage>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={full} onClick={create} className={buttonClass("primary")}>
              {C.create}
            </button>
            {onBack && (
              <button type="button" onClick={onBack} className={buttonClass("secondary")}>
                {C.cancel}
              </button>
            )}
          </div>
          <p className="max-w-[68ch] text-xs text-muted">{C.sources}</p>
        </section>
      </div>
    </div>
  );
}

/** The template's layout in miniature. */
function TemplateThumb({ template }: { template: Template }) {
  const rects = useMemo(() => {
    let i = 0;
    return newCanvas({ id: "t", name: "t", template, symbol: "AAPL", ids: () => `t-${i++}` }, "1970-01-01T00:00:00.000Z").widgets;
  }, [template]);
  const b = bounds(rects);
  if (!b) return <div className="h-20 rounded-md border border-dashed border-line-strong" aria-hidden="true" />;
  const k = Math.min(1, 80 / b.h);
  return (
    <div className="relative h-20 overflow-hidden" aria-hidden="true">
      {rects.map((r) => (
        <span
          key={r.id}
          className={`absolute rounded-[3px] border border-line-strong ${r.kind === "chart" ? "bg-fg/15" : "bg-panel-2"}`}
          style={{ left: (r.x - b.x) * k * (80 / Math.max(80, b.h * k)), top: (r.y - b.y) * k, width: r.w * k - 2, height: r.h * k - 2 }}
        />
      ))}
    </div>
  );
}

// ---- Working on a canvas -----------------------------------------------------------------------

function Workspace({ stored, all, select, startNew }: { stored: CanvasDoc; all: CanvasDoc[]; select: (id: string | null) => void; startNew: () => void }) {
  const { t } = useI18n();
  const C = t.canvas;
  const [doc, setDoc] = useState(stored);
  const docRef = useRef(doc);
  const [view, setViewState] = useState(stored.view);
  const viewRef = useRef(view);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gone = useRef(false); // deleted: nothing left to save

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!gone.current) saveCanvas({ ...docRef.current, view: viewRef.current });
  }, []);
  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 500);
  }, [flush]);
  useEffect(() => {
    const onHide = () => timer.current && flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      if (timer.current) flush();
    };
  }, [flush]);
  // A change from elsewhere (another tab, the account) shows up when nothing here is unsaved.
  useEffect(() => {
    if (!timer.current && stored.updatedAt !== docRef.current.updatedAt) {
      docRef.current = stored;
      setDoc(stored);
    }
  }, [stored]);

  const edit = useCallback(
    (fn: (d: CanvasDoc, now: string) => CanvasDoc) => {
      const next = fn(docRef.current, nowIso());
      if (next === docRef.current) return;
      docRef.current = next;
      setDoc(next);
      schedule();
    },
    [schedule],
  );
  const setView = useCallback(
    (v: View) => {
      viewRef.current = v;
      setViewState(v);
      schedule();
    },
    [schedule],
  );

  const surfaceRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const sizeRef = useRef(size);
  sizeRef.current = size;

  // A new canvas opens showing its windows (at a readable zoom).
  useEffect(() => {
    if (size.w === 0 || !fitOnOpen.has(doc.id)) return;
    fitOnOpen.delete(doc.id);
    const f = fitView(doc.widgets, size.w, size.h);
    const b = bounds(doc.widgets);
    if (!b) return;
    setView(f.zoom >= 0.7 ? f : { zoom: 0.7, x: 24 - b.x * 0.7, y: 24 - b.y * 0.7 });
  }, [size, doc.id, doc.widgets, setView]);

  const [focused, setFocused] = useState<string | null>(null);
  const [maxed, setMaxed] = useState<{ id: string; before: View } | null>(null);
  const maxedRef = useRef(maxed);
  maxedRef.current = maxed;
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const centre = () => {
    const v = visibleWorld(viewRef.current, sizeRef.current.w || 1200, sizeRef.current.h || 800);
    return { x: v.x + v.w / 2, y: v.y + v.h / 2 };
  };
  const full = () => toast({ message: fill(C.full, { n: MAX_WIDGETS }) });
  const onScreen = () => visibleWorld(viewRef.current, sizeRef.current.w || 1200, sizeRef.current.h || 800);
  /** Shows a window that just appeared, moving the view only if it's (partly) off screen. */
  const show = (r: Rect) => {
    if (sizeRef.current.w === 0) return;
    const v = reveal(viewRef.current, r, sizeRef.current.w, sizeRef.current.h);
    if (v.x !== viewRef.current.x || v.y !== viewRef.current.y) setView(v);
  };

  const actions: WindowActions = useMemo(
    () => ({
      focus: (id) => {
        setFocused(id);
        edit((d) => focusWidget(d, id));
      },
      rect: (id, r) => edit((d, now) => updateWidget(d, id, r, now)),
      busy: setBusy,
      close: (id) => {
        const { doc: next, removed } = removeWidget(docRef.current, id, nowIso());
        if (!removed) return;
        if (maxedRef.current?.id === id) {
          setView(maxedRef.current.before);
          setMaxed(null);
        }
        edit(() => next);
        toast({ message: C.closed, action: { label: C.undo, run: () => edit((d, now) => restoreWidget(d, removed, now)) } });
      },
      duplicate: (id) => {
        const r = duplicateWidget(docRef.current, id, newId("w"), nowIso());
        if (r.ok) {
          edit(() => r.doc);
          setFocused(r.widget.id);
          show(r.widget);
        } else if (r.reason === "full") full();
      },
      maximize: (id) => {
        const m = maxedRef.current;
        if (m?.id === id) {
          setMaxed(null);
          setView(m.before);
          return;
        }
        const w = docRef.current.widgets.find((x) => x.id === id);
        if (!w) return;
        setMaxed({ id, before: m ? m.before : viewRef.current });
        setFocused(id);
        edit((d) => focusWidget(d, id));
        setView({ zoom: 1, x: 12 - w.x, y: 12 - w.y });
      },
      symbol: (id, s) => edit((d, now) => setWidgetSymbol(d, id, s, now)),
      link: (id, l) => edit((d, now) => setWidgetLink(d, id, l, now)),
      interval: (id, i) => edit((d, now) => updateWidget(d, id, { interval: i }, now)),
      view: (id, v) => edit((d, now) => updateWidget(d, id, { view: v }, now)),
      text: (id, text) => edit((d, now) => updateWidget(d, id, { text }, now)),
      open: (id, kind) => {
        const src = docRef.current.widgets.find((x) => x.id === id);
        if (!src) return;
        const r = addWidget(docRef.current, { id: newId("w"), kind, symbol: src.symbol, link: src.link, near: { x: src.x + src.w + GAP + 380, y: src.y + 260 } }, nowIso());
        if (r.ok) {
          edit(() => r.doc);
          setFocused(r.widget.id);
          show(r.widget);
        } else if (r.reason === "full") full();
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [edit, setView],
  );

  const add = (kind: WidgetKind, symbol: string, link: LinkGroup) => {
    const r = addWidget(docRef.current, { id: newId("w"), kind, symbol, link, near: centre(), within: onScreen() }, nowIso());
    if (!r.ok) return r.reason === "full" ? full() : undefined;
    edit(() => r.doc);
    setFocused(r.widget.id);
    setAdding(false);
    show(r.widget);
    // Put the keyboard on the new window's title.
    requestAnimationFrame(() => (document.querySelector(`[data-window="${r.widget.id}"] button[aria-label*="${C.kinds[kind].name}"]`) as HTMLElement | null)?.focus());
  };

  const zoomBy = (f: number) => setView(zoomAt(viewRef.current, f, sizeRef.current.w / 2, sizeRef.current.h / 2));
  const fit = () => setView(fitView(docRef.current.widgets, sizeRef.current.w, sizeRef.current.h));
  const onKey = (key: string) => {
    if (key === "Escape" && maxedRef.current) {
      actions.maximize(maxedRef.current.id);
      return true;
    }
    if (maxedRef.current) return false;
    if (key === "+" || key === "=") zoomBy(1.2);
    else if (key === "-" || key === "_") zoomBy(1 / 1.2);
    else if (key === "0") zoomBy(1 / viewRef.current.zoom);
    else if (key === "1") fit();
    else if (key === "n" || key === "N") setAdding(true);
    else return false;
    return true;
  };

  const applyTemplate = (template: Template) => {
    const symbol = docRef.current.widgets.find((w) => w.symbol)?.symbol ?? "AAPL";
    const fresh = newCanvas({ id: doc.id, name: doc.name, template, symbol, ids: () => newId("w") }, nowIso());
    edit((d) => ({ ...d, widgets: fresh.widgets, updatedAt: fresh.updatedAt }));
    fitOnOpen.add(doc.id);
    setSize((s) => ({ ...s })); // re-run the fit
  };

  const remove = () => {
    if (!window.confirm(fill(C.deleteConfirm, { n: doc.name, w: doc.widgets.length }))) return;
    gone.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    deleteCanvas(doc.id);
    toast({ message: C.deleted });
    select(all.find((c) => c.id !== doc.id)?.id ?? null);
  };
  const duplicateCanvas = () => {
    if (all.length >= MAX_CANVASES) return toast({ message: fill(C.tooMany, { n: MAX_CANVASES }) });
    flush();
    const copy: CanvasDoc = { ...docRef.current, id: newId("c"), name: fill(C.copyName, { n: doc.name }).slice(0, 40), view: viewRef.current, updatedAt: nowIso(), widgets: docRef.current.widgets.map((w) => ({ ...w, id: newId("w") })) };
    saveCanvas(copy);
    select(copy.id);
  };
  const rename = (name: string) => edit((d, now) => ({ ...d, name: name.replace(/\s+/g, " ").trim().slice(0, 40) || d.name, updatedAt: now }));

  const mounted = useMounted(doc, view, size);
  const focusedWidget = doc.widgets.find((w) => w.id === focused) ?? null;
  const groups = useMemo(() => {
    const g: Record<number, string | null> = { 1: null, 2: null, 3: null };
    for (const w of doc.widgets) if (w.link && !g[w.link]) g[w.link] = w.symbol;
    return g;
  }, [doc.widgets]);
  const defaultSymbol = focusedWidget?.symbol ?? groups[1] ?? doc.widgets.find((w) => w.symbol)?.symbol ?? "AAPL";
  const defaultLink: LinkGroup = focusedWidget && focusedWidget.kind !== "note" ? focusedWidget.link : groups[1] ? 1 : 0;

  return (
    <div className="flex h-full flex-col">
      <h1 className="sr-only">{`${C.title}: ${doc.name}`}</h1>
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-bg px-3 py-1.5 sm:px-4">
        <CanvasSwitcher doc={doc} all={all} select={(id) => select(id)} startNew={startNew} rename={rename} duplicate={duplicateCanvas} remove={remove} />
        <AddWindow open={adding} setOpen={setAdding} symbol={defaultSymbol} link={defaultLink} groups={groups} full={doc.widgets.length >= MAX_WIDGETS} onAdd={add} />
        <div className="ml-auto flex items-center gap-0.5">
          <button type="button" aria-label={C.zoomOut} title={C.zoomOut} onClick={() => zoomBy(1 / 1.2)} className={iconBtn}>
            <MinusIcon size={16} />
          </button>
          <button type="button" aria-label={`${C.zoomReset} (${Math.round(view.zoom * 100)} %)`} title={C.zoomReset} onClick={() => zoomBy(1 / view.zoom)} className="num h-11 min-w-12 rounded-md px-1.5 text-xs text-muted hover:bg-panel-2 hover:text-fg sm:h-8">
            {Math.round(view.zoom * 100)}%
          </button>
          <button type="button" aria-label={C.zoomIn} title={C.zoomIn} onClick={() => zoomBy(1.2)} className={iconBtn}>
            <PlusIcon size={16} />
          </button>
          <button type="button" onClick={fit} className="inline-flex h-11 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted hover:bg-panel-2 hover:text-fg sm:h-8">
            <FitIcon size={16} />
            <span className="hidden sm:inline">{C.fit}</span>
            <span className="sr-only sm:hidden">{C.fit}</span>
          </button>
          <Shortcuts />
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <Surface doc={doc} view={view} setView={setView} size={size} surfaceRef={surfaceRef} locked={!!maxed} busy={busy} setBusy={setBusy} onKey={onKey}>
          {doc.widgets.map((w) => (
            <CanvasWindow
              key={w.id}
              widget={w}
              zoom={view.zoom}
              focused={focused === w.id}
              maximized={maxed?.id === w.id}
              display={maxed?.id === w.id ? { x: w.x, y: w.y, w: Math.max(240, size.w - 24), h: Math.max(160, size.h - 24) } : undefined}
              mounted={mounted.has(w.id)}
              actions={actions}
            />
          ))}
        </Surface>
        {doc.widgets.length === 0 && (
          <div className="absolute left-4 top-4 z-10 max-w-sm rounded-lg border border-line bg-panel p-4 sm:left-6 sm:top-6">
            <p className="font-medium">{C.empty}</p>
            <p className="mt-1 text-sm text-muted">{C.emptyHint}</p>
            <p className="control-label mb-1.5 mt-4">{C.useTemplate}</p>
            <div className="flex flex-wrap gap-2">
              {TEMPLATES.filter((k) => k !== "blank").map((k) => (
                <button key={k} type="button" onClick={() => applyTemplate(k)} className={buttonClass("secondary", true)}>
                  {C.templates[k].name}
                </button>
              ))}
            </div>
          </div>
        )}
        {doc.widgets.length > 0 && !maxed && size.w > 0 && <Minimap widgets={doc.widgets} view={view} size={size} focused={focused} setView={setView} label={C.minimap} />}
      </div>
    </div>
  );
}

function CanvasSwitcher({
  doc,
  all,
  select,
  startNew,
  rename,
  duplicate,
  remove,
}: {
  doc: CanvasDoc;
  all: CanvasDoc[];
  select: (id: string) => void;
  startNew: () => void;
  rename: (name: string) => void;
  duplicate: () => void;
  remove: () => void;
}) {
  const { t } = useI18n();
  const C = t.canvas;
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(doc.name);
  const close = useCallback(() => {
    setOpen(false);
    setRenaming(false);
  }, []);
  const item = "flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-panel-2 sm:min-h-9";
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${C.switchTo}: ${doc.name}`}
        onClick={() => (open ? close() : setOpen(true))}
        className="inline-flex h-11 max-w-[42vw] items-center gap-1.5 rounded-md px-2 text-sm font-semibold hover:bg-panel-2 sm:h-9 sm:max-w-xs"
      >
        <CanvasIcon size={16} className="text-muted" />
        <span className="truncate">{doc.name}</span>
        <ChevronDownIcon size={14} className="text-muted" />
      </button>
      <Popover open={open} onClose={close} label={C.canvases} className="left-0 w-72 p-1.5">
        {renaming ? (
          <form
            className="space-y-2 p-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              rename(name);
              close();
            }}
          >
            <label htmlFor="canvas-name" className="control-label block">
              {C.renameLabel}
            </label>
            <input id="canvas-name" autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className="h-11 w-full rounded-lg border border-line-strong bg-panel px-3 text-sm outline-none focus:border-accent sm:h-9" />
            <div className="flex gap-2">
              <button type="submit" className={buttonClass("secondary", true)}>
                {C.save}
              </button>
              <button type="button" onClick={() => setRenaming(false)} className={buttonClass("ghost", true)}>
                {C.cancel}
              </button>
            </div>
          </form>
        ) : (
          <>
            <p className="px-2 pb-1 pt-0.5 text-xs text-muted">{C.canvases}</p>
            {all.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-current={c.id === doc.id ? "true" : undefined}
                onClick={() => {
                  close();
                  if (c.id !== doc.id) select(c.id);
                }}
                className={`${item} justify-between ${c.id === doc.id ? "bg-panel-2 font-medium" : ""}`}
              >
                <span className="truncate">{c.name}</span>
                <span className="num shrink-0 text-xs text-muted">{c.widgets.length}</span>
              </button>
            ))}
            <div className="my-1 border-t border-line" />
            <button type="button" onClick={() => (close(), startNew())} className={item}>
              {C.newCanvas}
            </button>
            <button
              type="button"
              onClick={() => {
                setName(doc.name);
                setRenaming(true);
              }}
              className={item}
            >
              {C.rename}
            </button>
            <button type="button" onClick={() => (close(), duplicate())} className={item}>
              {C.duplicate}
            </button>
            <button type="button" onClick={() => (close(), remove())} className={`${item} text-down`}>
              {C.delete}
            </button>
          </>
        )}
      </Popover>
    </div>
  );
}

function AddWindow({
  open,
  setOpen,
  symbol: initialSymbol,
  link: initialLink,
  groups,
  full,
  onAdd,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  symbol: string;
  link: LinkGroup;
  groups: Record<number, string | null>;
  full: boolean;
  onAdd: (kind: WidgetKind, symbol: string, link: LinkGroup) => void;
}) {
  const { t } = useI18n();
  const C = t.canvas;
  const [symbol, setSymbol] = useState(initialSymbol);
  const [link, setLink] = useState<LinkGroup>(initialLink);
  useEffect(() => {
    if (open) {
      setSymbol(initialSymbol);
      setLink(initialLink);
    }
    // Only when it opens: the defaults follow the focused window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // A different company leaves the group; joining a group shows its company.
  const pickSymbol = (s: string) => {
    setSymbol(s);
    if (link && groups[link] && groups[link] !== s) setLink(0);
  };
  const pickLink = (l: LinkGroup) => {
    setLink(l);
    if (l && groups[l]) setSymbol(groups[l]!);
  };
  const close = useCallback(() => setOpen(false), [setOpen]);
  return (
    <div className="relative">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={buttonClass("primary", true)}>
        <PlusIcon size={16} />
        {C.add}
      </button>
      <Popover open={open} onClose={close} label={C.addTitle} sheet className="p-4 sm:left-0 sm:w-[560px]">
        <h2 className="section-title">{C.addTitle}</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_auto]">
          <div>
            <p className="control-label mb-1.5">{C.addSymbol}</p>
            <div className="flex items-center gap-2">
              <span className="num inline-flex h-11 shrink-0 items-center rounded-lg border border-line-strong px-3 text-sm font-semibold sm:h-9" data-testid="add-symbol">
                {symbol}
              </span>
              <div className="min-w-0 flex-1">
                <TickerSearch label={C.addSymbol} onSelect={pickSymbol} />
              </div>
            </div>
          </div>
          <div>
            <p className="control-label mb-1.5">{C.addLink}</p>
            <div role="group" aria-label={C.addLink} className="inline-flex rounded-lg border border-line bg-panel-2 p-0.5">
              {LINKS.map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={link === l}
                  aria-label={C.links[l]}
                  title={l && groups[l] ? `${C.links[l]}: ${groups[l]}` : C.links[l]}
                  onClick={() => pickLink(l)}
                  className={`grid h-11 min-w-11 place-items-center rounded-md px-2 sm:h-8 sm:min-w-9 ${link === l ? "bg-panel ring-1 ring-line-strong" : ""}`}
                >
                  <LinkSwatch link={l} />
                </button>
              ))}
            </div>
          </div>
        </div>
        {full && <StatusMessage tone="warn" className="mt-4">{fill(C.full, { n: MAX_WIDGETS })}</StatusMessage>}
        <div className="mt-4 space-y-4">
          {KIND_GROUPS.map((g) => (
            <section key={g.key} aria-label={C.groups[g.key]}>
              <h3 className="control-label mb-1">{C.groups[g.key]}</h3>
              <div className="grid gap-0.5 sm:grid-cols-2">
                {g.kinds.map((k) => (
                  <button
                    key={k}
                    type="button"
                    disabled={full}
                    onClick={() => onAdd(k, symbol, link)}
                    className="flex min-h-11 flex-col items-start rounded-md px-2.5 py-2 text-left hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="text-sm font-medium">{C.kinds[k].name}</span>
                    <span className="text-xs leading-snug text-muted">{C.kinds[k].desc}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </Popover>
    </div>
  );
}

function Shortcuts() {
  const { t } = useI18n();
  const C = t.canvas;
  const sync = useSyncStatus();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <div className="relative">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="inline-flex h-11 items-center rounded-md px-2 text-[13px] text-muted hover:bg-panel-2 hover:text-fg sm:h-8">
        {C.shortcuts}
      </button>
      <Popover open={open} onClose={close} label={C.shortcuts} className="right-0 w-[min(22rem,calc(100vw-1.5rem))] p-4">
        <dl className="space-y-2 text-sm">
          {C.keys.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[minmax(0,9rem)_1fr] gap-3">
              <dt className="text-xs font-medium">{k}</dt>
              <dd className="text-xs text-muted">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 border-t border-line pt-3 text-xs text-muted">{sync.kind === "local" ? C.savedLocal : C.saved}</p>
      </Popover>
    </div>
  );
}
