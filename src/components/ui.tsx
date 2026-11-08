"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtPct, fmtPrice } from "@/lib/format";
import type { Level } from "@/lib/scoring";
import type { DataIssue, DataSource, Quote } from "@/lib/types";
import { useWatchlist, WATCHLIST_LIMIT } from "@/lib/watchlist";
import { AlertIcon, CheckIcon, ClockIcon, CloseIcon, DirectionGlyph, InfoIcon, StarIcon } from "./icons";

// ---- Layout -----------------------------------------------------------------------------

export function Panel({
  title,
  children,
  className = "",
  action,
  id,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className={`rounded-xl border border-line bg-panel p-4 sm:p-5 ${className}`} aria-labelledby={title && id ? `${id}-title` : undefined}>
      {title && (
        <div className="flex items-center justify-between gap-2 mb-3 min-h-6">
          <h2 id={id ? `${id}-title` : undefined} className="text-xs font-semibold uppercase tracking-wider text-muted">
            {title}
          </h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// ---- Controls ---------------------------------------------------------------------------

type Variant = "primary" | "secondary" | "ghost";
const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg border-accent hover:brightness-110",
  secondary: "bg-panel text-fg border-line hover:bg-panel-2",
  ghost: "bg-transparent text-fg border-transparent hover:bg-panel-2",
};

/** 44 px tall by default (comfortable touch target); `compact` is for dense desktop toolbars only. */
export function buttonClass(variant: Variant = "secondary", compact = false, extra = "") {
  return `inline-flex items-center justify-center gap-2 rounded-lg border text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
    compact ? "h-11 sm:h-9 px-3" : "h-11 px-4"
  } ${VARIANT[variant]} ${extra}`;
}

export function Button({
  variant = "secondary",
  compact = false,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; compact?: boolean }) {
  return <button type="button" className={buttonClass(variant, compact, className)} {...props} />;
}

/**
 * A set of mutually exclusive options (range, chart style…). Each option is a toggle button
 * with aria-pressed inside a labelled group: simple, and fully usable with keyboard or touch.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className = "",
}: {
  label: string;
  options: { value: T; label: React.ReactNode; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={`inline-flex rounded-lg border border-line bg-panel-2 p-0.5 ${className}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`h-10 sm:h-8 min-w-11 sm:min-w-9 px-3 rounded-md text-xs font-semibold transition-colors ${
            value === o.value ? "bg-panel text-fg shadow-sm ring-1 ring-line" : "text-muted hover:text-fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** An on/off option (indicators): a chip with a check mark when on. */
export function ToggleChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-10 sm:h-9 px-3 rounded-full border text-xs font-semibold transition-colors ${
        on ? "border-accent bg-accent/10 text-fg" : "border-line bg-panel text-muted hover:text-fg"
      }`}
    >
      <span className={`grid place-items-center h-4 w-4 rounded-full border ${on ? "border-accent bg-accent text-accent-fg" : "border-line"}`} aria-hidden="true">
        {on && <CheckIcon size={12} />}
      </span>
      {children}
    </button>
  );
}

// ---- Status -----------------------------------------------------------------------------

type Tone = "neutral" | "info" | "good" | "warn" | "bad";
const TONE: Record<Tone, string> = {
  neutral: "bg-panel-2 text-muted",
  info: "bg-info-bg text-info",
  good: "bg-up-bg text-up",
  warn: "bg-warn-bg text-warn",
  bad: "bg-down-bg text-down",
};

export function Badge({ tone = "neutral", children, className = "" }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${TONE[tone]} ${className}`}>{children}</span>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`rounded-md bg-panel-2 animate-pulse motion-reduce:animate-none ${className}`} aria-hidden="true" />;
}

/** A message about the state of a section. Polite live region so changes are announced. */
export function StatusMessage({
  tone = "info",
  children,
  action,
  className = "",
}: {
  tone?: "info" | "warn" | "error";
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const Icon = tone === "info" ? InfoIcon : AlertIcon;
  const color = tone === "error" ? "text-down" : tone === "warn" ? "text-warn" : "text-muted";
  return (
    <div role="status" className={`flex items-start gap-2 text-sm ${className}`}>
      <Icon size={18} className={`mt-0.5 ${color}`} />
      <div className="min-w-0 flex-1">
        <p className="text-muted">{children}</p>
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** Explains why a section has no data. */
export function IssueNote({ issue, className = "" }: { issue: DataIssue; className?: string }) {
  const { t } = useI18n();
  return (
    <StatusMessage tone={issue === "rate_limited" || issue === "upstream" ? "warn" : "info"} className={className}>
      {t.data.issues[issue]}
    </StatusMessage>
  );
}

// ---- Prices -----------------------------------------------------------------------------

/** Price change with sign, arrow and color: the meaning never depends on color alone. */
export function Change({ value, pct, className = "" }: { value?: number; pct: number; className?: string }) {
  const { lang } = useI18n();
  const up = pct >= 0;
  const abs = value !== undefined ? `${value > 0 ? "+" : value < 0 ? "−" : ""}${fmtPrice(Math.abs(value), lang).replace(/^\$/, "")} ` : "";
  return (
    <span className={`num inline-flex items-center gap-1 whitespace-nowrap ${up ? "text-up" : "text-down"} ${className}`}>
      <DirectionGlyph up={up} />
      {abs}
      {value !== undefined ? `(${fmtPct(pct, lang, { sign: true }).replace("-", "−")})` : fmtPct(pct, lang, { sign: true }).replace("-", "−")}
    </span>
  );
}

/** "Source: FMP · Updated 6 Nov, 16:00 ET", with a stale marker when a refresh failed. */
export function Provenance({
  source,
  asOf,
  stale = false,
  className = "",
}: {
  source: DataSource;
  asOf?: string;
  stale?: boolean;
  className?: string;
}) {
  const { t, lang } = useI18n();
  return (
    <p className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted ${className}`}>
      <span>
        {t.data.source}: {source === "DEMO" ? t.data.demoSource : "Financial Modeling Prep"}
      </span>
      {asOf && (
        <>
          <span aria-hidden="true">·</span>
          <span>
            {t.data.updated} <time dateTime={asOf}>{fmtAsOf(asOf, lang)}</time>
          </span>
        </>
      )}
      {stale && (
        <Badge tone="warn">
          <ClockIcon size={12} />
          {t.ux.stale}
        </Badge>
      )}
    </p>
  );
}

export function QuoteTile({ q, label }: { q: Quote; label?: string }) {
  const { lang } = useI18n();
  return (
    <Link
      href={`/stock/${q.symbol}`}
      prefetch={false}
      className="block rounded-lg border border-line bg-panel hover:bg-panel-2 hover:border-accent/60 transition-colors p-3 min-w-0"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="num font-bold text-accent">{q.symbol}</span>
        <span className="text-[11px] text-muted truncate">{label ?? q.name}</span>
      </div>
      <div className="num text-lg font-semibold mt-1">{fmtPrice(q.price, lang)}</div>
      <Change pct={q.changePercent} className="text-sm" />
    </Link>
  );
}

// ---- Scores -----------------------------------------------------------------------------

const LEVEL_STYLE: Record<Level, string> = {
  good: "bg-up-bg text-up",
  ok: "bg-warn-bg text-warn",
  bad: "bg-down-bg text-down",
  neutral: "bg-info-bg text-info",
};
const LEVEL_DOT: Record<Level, string> = { good: "bg-up", ok: "bg-warn", bad: "bg-down", neutral: "bg-info" };

export function LevelBadge({ level }: { level: Level }) {
  const { t } = useI18n();
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${LEVEL_STYLE[level]}`}>
      <LevelMark level={level} />
      {t.stock.scoreLegend[level]}
    </span>
  );
}

/** Colour plus shape: good ▲-ish circle, ok square, bad diamond, neutral ring. */
export function LevelMark({ level, className = "" }: { level: Level; className?: string }) {
  const shape = level === "ok" ? "rounded-[2px]" : level === "bad" ? "rotate-45 rounded-[2px]" : "rounded-full";
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 ${shape} ${LEVEL_DOT[level]} ${className}`} aria-hidden="true" />;
}

export function Dot({ level }: { level: Level }) {
  return <LevelMark level={level} className="mt-1.5" />;
}

/** Expandable "What is this?" explanation; works with touch and keyboard. */
export function Explain({ children, label }: { children: React.ReactNode; label?: string }) {
  const { t } = useI18n();
  return (
    <details className="group mt-2 text-sm">
      <summary className="cursor-pointer select-none text-info text-xs inline-flex items-center gap-1 min-h-8 rounded">
        <InfoIcon size={14} />
        {label ?? t.chart.whatIs}
      </summary>
      <div className="mt-1.5 text-muted leading-relaxed">{children}</div>
    </details>
  );
}

/** A labelled percentile (0–100) with a marker bar and a sentence; used inside a <dl>. */
export function Comparison({ label, percentile, text }: { label: string; percentile?: number; text: string }) {
  return (
    <div>
      <dt className="font-medium">{label}</dt>
      {percentile !== undefined && (
        <div className="relative my-1 h-1.5 rounded-full bg-panel-2" aria-hidden="true">
          <div className="absolute inset-y-0 left-0 rounded-full bg-accent/40" style={{ width: `${percentile}%` }} />
          <div className="absolute -top-0.5 h-2.5 w-1 rounded-full bg-accent" style={{ left: `calc(${percentile}% - 2px)` }} />
        </div>
      )}
      <dd className="text-muted">{text}</dd>
    </div>
  );
}

// ---- Watchlist action -------------------------------------------------------------------

export function WatchButton({ symbol, className = "" }: { symbol: string; className?: string }) {
  const { t } = useI18n();
  const { has, add, remove, list } = useWatchlist();
  const on = has(symbol);
  const full = !on && list.length >= WATCHLIST_LIMIT;
  const click = () => {
    if (on) {
      const index = list.indexOf(symbol);
      remove(symbol);
      toast({ message: fill(t.ux.removed, { s: symbol }), action: { label: t.ux.undo, run: () => add(symbol, index) } });
    } else if (full) {
      toast({ message: fill(t.ux.listFull, { n: WATCHLIST_LIMIT }) });
    } else {
      add(symbol);
      toast({ message: fill(t.ux.added, { s: symbol }), link: { label: t.ux.viewList, href: "/watchlist" } });
    }
  };
  return (
    <button
      type="button"
      onClick={click}
      aria-pressed={on}
      className={`${buttonClass(on ? "primary" : "secondary")} ${className}`}
    >
      <StarIcon filled={on} size={18} />
      {on ? t.stock.removeWatch : t.stock.addWatch}
    </button>
  );
}

// ---- Toasts -----------------------------------------------------------------------------
// Short confirmations (saved, removed + undo). One global queue; rendered once by AppChrome.

export interface ToastInput {
  message: string;
  action?: { label: string; run: () => void };
  link?: { label: string; href: string };
}
interface ToastItem extends ToastInput {
  id: number;
}

let toasts: ToastItem[] = [];
let nextId = 1;
const toastListeners = new Set<() => void>();
const emit = () => toastListeners.forEach((l) => l());

export function toast(input: ToastInput) {
  toasts = [...toasts.slice(-2), { ...input, id: nextId++ }];
  emit();
}
function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}
const EMPTY_TOASTS: ToastItem[] = [];

export function Toaster() {
  const { t } = useI18n();
  const items = useSyncExternalStore(
    (cb) => {
      toastListeners.add(cb);
      return () => toastListeners.delete(cb);
    },
    () => toasts,
    () => EMPTY_TOASTS,
  );
  return (
    <div aria-live="polite" className="fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4 pointer-events-none bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-6">
      {items.map((item) => (
        <ToastView key={item.id} item={item} closeLabel={t.ux.dismiss} />
      ))}
    </div>
  );
}

function ToastView({ item, closeLabel }: { item: ToastItem; closeLabel: string }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const id = setTimeout(() => dismiss(item.id), item.action ? 8000 : 5000);
    return () => clearTimeout(id);
  }, [item, paused]);
  return (
    <div
      className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border border-line bg-panel px-4 py-2 shadow-lg"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <p className="flex-1 text-sm">{item.message}</p>
      {item.action && (
        <button
          type="button"
          className="h-11 px-2 text-sm font-semibold text-accent"
          onClick={() => {
            item.action!.run();
            dismiss(item.id);
          }}
        >
          {item.action.label}
        </button>
      )}
      {item.link && (
        <Link href={item.link.href} className="h-11 inline-flex items-center px-2 text-sm font-semibold text-accent" onClick={() => dismiss(item.id)}>
          {item.link.label}
        </Link>
      )}
      <button type="button" aria-label={closeLabel} className="grid h-11 w-11 -mr-2 place-items-center text-muted hover:text-fg" onClick={() => dismiss(item.id)}>
        <CloseIcon size={18} />
      </button>
    </div>
  );
}
