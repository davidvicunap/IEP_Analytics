"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtPct, fmtPrice } from "@/lib/format";
import type { Level } from "@/lib/scoring";
import type { DataIssue, DataSource, Quote } from "@/lib/types";
import { useWatchlist } from "@/lib/watchlist";

export function Panel({ title, children, className = "", action }: { title?: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <section className={`rounded-xl border border-line bg-panel p-4 ${className}`}>
      {title && (
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Change({ value, pct, className = "" }: { value?: number; pct: number; className?: string }) {
  const { lang } = useI18n();
  const up = pct >= 0;
  return (
    <span className={`num ${up ? "text-up" : "text-down"} ${className}`}>
      <span aria-hidden="true">{up ? "▲" : "▼"}</span>{" "}
      {value !== undefined && <>{value > 0 ? "+" : ""}{value.toFixed(2)} </>}
      ({fmtPct(pct, lang, { sign: true })})
    </span>
  );
}

export function QuoteTile({ q, label }: { q: Quote; label?: string }) {
  const { lang } = useI18n();
  return (
    <Link
      href={`/stock/${q.symbol}`}
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

/** A quote that could not be loaded keeps its slot and says why. */
export function MissingTile({ symbol, label, issue }: { symbol: string; label?: string; issue: DataIssue }) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border border-dashed border-line p-3 min-w-0" title={t.data.issues[issue]}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="num font-bold text-muted">{symbol}</span>
        {label && <span className="text-[11px] text-muted truncate">{label}</span>}
      </div>
      <div className="num text-lg font-semibold mt-1 text-muted">—</div>
      <span className="text-xs text-muted">{t.data.issuesShort[issue]}</span>
    </div>
  );
}

/** Explains why a section has no data. */
export function IssueNote({ issue, className = "" }: { issue: DataIssue; className?: string }) {
  const { t } = useI18n();
  return (
    <p role="status" className={`flex gap-2 text-sm text-muted ${className}`}>
      <span aria-hidden="true">ⓘ</span>
      <span>{t.data.issues[issue]}</span>
    </p>
  );
}

/** "Source: FMP · Updated 6 Nov, 16:00 ET" */
export function Provenance({ source, asOf, className = "" }: { source: DataSource; asOf?: string; className?: string }) {
  const { t, lang } = useI18n();
  return (
    <p className={`text-[11px] text-muted ${className}`}>
      {t.data.source}: {source === "DEMO" ? t.data.demoSource : "Financial Modeling Prep"}
      {asOf && (
        <>
          {" · "}
          {t.data.updated} <time dateTime={asOf}>{fmtAsOf(asOf, lang)}</time>
        </>
      )}
    </p>
  );
}

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
      <span className={`h-2 w-2 rounded-full ${LEVEL_DOT[level]}`} aria-hidden="true" />
      {t.stock.scoreLegend[level]}
    </span>
  );
}

export function Dot({ level }: { level: Level }) {
  return <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${LEVEL_DOT[level]}`} aria-hidden="true" />;
}

/** Expandable "What is this?" explanation; works with touch and keyboard. */
export function Explain({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <details className="group mt-2 text-sm">
      <summary className="cursor-pointer select-none text-info text-xs inline-flex items-center gap-1 min-h-6">
        <span aria-hidden="true" className="inline-grid place-items-center h-4 w-4 rounded-full border border-current text-[10px]">?</span>
        {t.chart.whatIs}
      </summary>
      <p className="mt-1.5 text-muted leading-relaxed">{children}</p>
    </details>
  );
}

export function WatchButton({ symbol }: { symbol: string }) {
  const { t } = useI18n();
  const { has, toggle } = useWatchlist();
  const on = has(symbol);
  return (
    <button
      type="button"
      onClick={() => toggle(symbol)}
      aria-pressed={on}
      className={`h-10 px-4 rounded-lg text-sm font-semibold border transition-colors ${
        on ? "bg-accent text-accent-fg border-accent" : "border-line bg-panel hover:bg-panel-2"
      }`}
    >
      <span aria-hidden="true">{on ? "★" : "☆"}</span> {on ? t.stock.removeWatch : t.stock.addWatch}
    </button>
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
