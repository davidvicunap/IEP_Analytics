"use client";

import Link from "next/link";
import { Fragment, useEffect, useId, useMemo, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtBig, fmtDate, fmtNum, fmtPrice } from "@/lib/format";
import { filingDocUrl } from "@/lib/filingsShared";
import { upside } from "@/lib/research";
import { useNotes } from "@/lib/researchClient";
import { isRetryable, type ViewIssue } from "@/lib/resource";
import { useSnapshots, type SnapState } from "@/lib/snapshotClient";
import type { FilingRef } from "@/lib/snapshotShared";
import { useQuotes, type QuoteView } from "@/lib/useQuotes";
import { COLUMNS, TAGS_PER_STOCK, cleanTag, nextSort, sortRows, tagCounts, type Column, type RowFacts, type SortDir, type SortKey } from "@/lib/watchDashboard";
import { useHydrated, useWatchColumns, useWatchlist, useWatchTags, WATCHLIST_LIMIT } from "@/lib/watchlist";
import TickerSearch from "./TickerSearch";
import { ChartIcon, CloseIcon, ColumnsIcon, FileTextIcon, RefreshIcon, StarIcon, TagIcon } from "./icons";
import { QuoteRowsSkeleton } from "./QuoteList";
import { Badge, Change, EmptyState, Panel, Provenance, Skeleton, StatusMessage, buttonClass, toast } from "./ui";

type Lang = "es" | "en";
type Row = RowFacts & { view: QuoteView; snap: SnapState | undefined; tags: string[] };

const DAY = 86_400_000;
const pctText = (v: number, lang: Lang) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtNum(Math.abs(v) * 100, lang, 1)}%`;

export default function WatchlistView() {
  const { t, lang } = useI18n();
  const W = t.watch;
  const { list, remove, add, persistent } = useWatchlist();
  const { tags, toggle: toggleTag, prune } = useWatchTags();
  const { columns, toggle: toggleColumn } = useWatchColumns();
  const hydrated = useHydrated();
  const [filter, setFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "saved", dir: "asc" });
  const [editing, setEditing] = useState<string | null>(null);

  // Tags of stocks no longer on the list are dropped when the page opens.
  useEffect(() => {
    if (hydrated) prune(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  const counts = useMemo(() => tagCounts(tags, list), [tags, list]);
  const activeFilter = filter && counts.some((c) => c.tag === filter) ? filter : null;
  const shown = useMemo(() => (activeFilter ? list.filter((s) => tags[s]?.includes(activeFilter)) : list), [list, tags, activeFilter]);

  const q = useQuotes(list);
  const needsSec = columns.some((c) => c === "quality" || c === "report" || c === "latest" || c === "insiders");
  const snaps = useSnapshots(shown, hydrated && needsSec);
  const notes = useNotes();
  const fairValues = useMemo(() => {
    const m = new Map<string, number>();
    if (notes.state.status === "ok") for (const n of notes.state.data) if (n.fairValue !== null) m.set(n.symbol, n.fairValue);
    return m;
  }, [notes.state]);

  const rows: Row[] = useMemo(() => {
    const byQuote = new Map(q.items.map((i) => [i.symbol, i]));
    const base = shown.map((symbol): Row => {
      const view = byQuote.get(symbol) ?? { symbol, stale: false };
      const snap = snaps.state[symbol];
      return {
        symbol,
        view,
        snap,
        tags: tags[symbol] ?? [],
        price: view.quote?.price ?? null,
        change: view.quote?.changePercent ?? null,
        marketCap: view.quote?.marketCap ?? null,
        fairValue: fairValues.get(symbol) ?? null,
        snapshot: snap?.status === "ok" ? snap.data : null,
      };
    });
    return sortRows(base, sort.key, sort.dir);
  }, [shown, q.items, snaps.state, tags, fairValues, sort]);

  const failedQuotes = q.items.filter((i) => !i.quote && i.error).length;
  const latest = q.items.map((i) => i.quote?.asOf ?? i.fetchedAt).filter((x): x is string => !!x).sort().at(-1);
  const secFailed = needsSec ? shown.map((s) => snaps.state[s]).filter((s): s is Extract<SnapState, { status: "error" }> => s?.status === "error") : [];
  const secLoading = needsSec && shown.some((s) => !snaps.state[s] || snaps.state[s].status === "loading");

  const removeWithUndo = (s: string) => {
    const index = list.indexOf(s);
    remove(s);
    toast({ message: fill(t.ux.removed, { s }), action: { label: t.ux.undo, run: () => add(s, index) } });
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] leading-tight">{t.watchlist.title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">{W.intro}</p>
        </div>
        {list.length > 0 && <p className="text-xs text-muted num">{fill(t.ux.countOf, { n: list.length, max: WATCHLIST_LIMIT })}</p>}
      </div>
      <div className="max-w-xl">
        <TickerSearch large />
      </div>

      <Panel>
        {!hydrated ? (
          <>
            <Skeleton className="h-11 w-56 mb-2" />
            <QuoteRowsSkeleton n={4} />
          </>
        ) : list.length === 0 ? (
          <EmptyState title={t.ux.emptyTitle}>
            <p className="inline-flex flex-wrap items-center justify-center gap-1">
              {t.ux.emptyHowA}
              <span className={buttonClass("secondary", true, "pointer-events-none !h-7 !px-2 text-xs")} aria-hidden="true">
                <StarIcon size={14} /> {t.stock.addWatch}
              </span>
              {t.ux.emptyHowB}
            </p>
          </EmptyState>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {counts.length > 0 && <TagFilter counts={counts} total={list.length} value={activeFilter} onChange={setFilter} />}
              <div className="ml-auto flex flex-wrap items-center gap-1">
                {sort.key !== "saved" && (
                  <button type="button" onClick={() => setSort({ key: "saved", dir: "asc" })} className={buttonClass("ghost", true, "text-muted")}>
                    {W.savedOrder}
                  </button>
                )}
                <ColumnsMenu columns={columns} onToggle={toggleColumn} />
                {list.length > 1 && (
                  <Link
                    href={`/charts?s=${shown.slice(0, 5).map(encodeURIComponent).join(",")}&m=revenue&f=annual&t=growth&k=line&r=10`}
                    className={buttonClass("ghost", true, "text-muted")}
                  >
                    <ChartIcon size={16} />
                    {t.ux.compareList}
                  </Link>
                )}
                <button type="button" onClick={q.refresh} disabled={q.refreshing || q.loading} className={buttonClass("ghost", true, "text-muted")}>
                  <RefreshIcon size={16} className={q.refreshing ? "animate-spin motion-reduce:animate-none" : ""} />
                  {q.refreshing ? t.ux.refreshing : t.ux.refresh}
                </button>
              </div>
            </div>

            {q.loading ? (
              <>
                <p role="status" className="sr-only">{t.ux.loading}</p>
                <QuoteRowsSkeleton n={Math.min(list.length, 30)} />
              </>
            ) : rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">{fill(W.noTagged, { t: activeFilter ?? "" })}</p>
            ) : (
              <Table
                rows={rows}
                columns={columns}
                sort={sort}
                onSort={(k) => setSort((cur) => nextSort(cur, k))}
                editing={editing}
                onEdit={setEditing}
                onToggleTag={toggleTag}
                allTags={counts.map((c) => c.tag)}
                onRemove={removeWithUndo}
                lang={lang}
              />
            )}

            {secLoading && <p role="status" className="sr-only">{W.loading}</p>}
            {q.issue && (
              <StatusMessage tone="warn" className="mt-3" action={q.issue === "beta_expired" ? <Link href="/beta?next=/watchlist" className="link text-sm font-medium">{t.ux.signInAgain}</Link> : undefined}>
                {t.ux.requestIssues[q.issue]}
                {q.retryAt && ` ${fill(t.ux.retryAt, { time: fmtAsOf(new Date(q.retryAt).toISOString(), lang) })}`}
              </StatusMessage>
            )}
            {!q.issue && failedQuotes > 0 && (
              <StatusMessage tone="warn" className="mt-3">
                {fill(t.ux.partial, { n: failedQuotes, total: list.length })}
              </StatusMessage>
            )}
            {secFailed.length > 0 && (
              <StatusMessage
                tone="warn"
                className="mt-3"
                action={
                  secFailed.some((s) => isRetryable(s.issue)) ? (
                    <button type="button" onClick={snaps.retry} className="link text-sm font-medium min-h-11">
                      {W.retry}
                    </button>
                  ) : undefined
                }
              >
                {fill(W.secIssues, { n: secFailed.length, t: shown.length, why: issueList(secFailed.map((s) => s.issue), t.data.issuesShort) })}
              </StatusMessage>
            )}
            {q.source && <Provenance source={q.source} asOf={latest} stale={q.items.some((i) => i.stale)} className="mt-3" />}
            <p className="mt-1 text-xs text-muted">{W.source}</p>
          </>
        )}
      </Panel>
      <p className="text-xs text-muted">{persistent ? t.watchlist.note : t.ux.memoryOnly}</p>
    </div>
  );
}

function issueList(issues: ViewIssue[], labels: Record<string, string>): string {
  return [...new Set(issues)].map((i) => (labels[i] ?? i).toLowerCase()).join(", ");
}

// ---- Toolbar -------------------------------------------------------------------------------

function TagFilter({ counts, total, value, onChange }: { counts: { tag: string; count: number }[]; total: number; value: string | null; onChange: (v: string | null) => void }) {
  const { t } = useI18n();
  const chip = (label: string, n: number, on: boolean, click: () => void) => (
    <button
      key={label}
      type="button"
      aria-pressed={on}
      onClick={click}
      className={`inline-flex h-11 sm:h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors ${
        on ? "border-accent bg-accent/10 text-fg" : "border-line bg-panel text-muted hover:text-fg"
      }`}
    >
      {label}
      <span className="num text-[11px] text-muted">{n}</span>
    </button>
  );
  return (
    <div role="group" aria-label={t.watch.filterBy} className="flex flex-wrap items-center gap-1.5">
      {chip(t.watch.all, total, value === null, () => onChange(null))}
      {counts.map((c) => chip(c.tag, c.count, value === c.tag, () => onChange(value === c.tag ? null : c.tag)))}
    </div>
  );
}

function ColumnsMenu({ columns, onToggle }: { columns: Column[]; onToggle: (c: Column) => void }) {
  const { t } = useI18n();
  const W = t.watch;
  const [open, setOpen] = useState(false);
  // On a phone the choices open in the page flow (full width); from tablet up, as a menu.
  return (
    <details className="sm:relative [&[open]]:basis-full sm:[&[open]]:basis-auto" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className={buttonClass("ghost", true, "text-muted list-none [&::-webkit-details-marker]:hidden cursor-pointer")}>
        <ColumnsIcon size={16} />
        {W.columns}
      </summary>
      {open && (
        <div className="mt-1 rounded-xl border border-line bg-panel p-2 shadow-lg sm:absolute sm:right-0 sm:z-20 sm:w-80">
          {COLUMNS.map((c) => (
            <label key={c} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-panel-2">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]" checked={columns.includes(c)} onChange={() => onToggle(c)} />
              <span>
                <span className="block text-sm font-medium">{W.cols[c]}</span>
                <span className="block text-xs text-muted">{W.colHelp[c]}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </details>
  );
}

// ---- Table ---------------------------------------------------------------------------------

function Table({
  rows,
  columns,
  sort,
  onSort,
  editing,
  onEdit,
  onToggleTag,
  allTags,
  onRemove,
  lang,
}: {
  rows: Row[];
  columns: Column[];
  sort: { key: SortKey; dir: SortDir };
  onSort: (k: SortKey) => void;
  editing: string | null;
  onEdit: (s: string | null) => void;
  onToggleTag: (symbol: string, tag: string) => void;
  allTags: string[];
  onRemove: (s: string) => void;
  lang: Lang;
}) {
  const { t } = useI18n();
  const W = t.watch;
  const header = (k: SortKey, label: string, align: "left" | "right" = "right", title?: string) => {
    const active = sort.key === k;
    return (
      <th scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={`py-2 px-2 font-normal ${align === "left" ? "text-left" : "text-right"}`}>
        <button
          type="button"
          onClick={() => onSort(k)}
          title={title}
          className={`inline-flex min-h-11 sm:min-h-9 items-center gap-1 whitespace-nowrap hover:text-fg ${active ? "text-fg font-medium" : ""}`}
          aria-label={fill(W.sortBy, { c: label })}
        >
          {label}
          {active && <span aria-hidden="true">{sort.dir === "asc" ? "↑" : "↓"}</span>}
        </button>
      </th>
    );
  };
  const span = 3 + columns.length;
  return (
    <div className="relative -mx-4 overflow-x-auto sm:mx-0" tabIndex={0} role="region" aria-label={t.watchlist.title}>
      <table className="num w-full min-w-[560px] text-sm">
        <thead>
          <tr className="text-xs text-muted border-b border-line">
            {header("symbol", W.cols.stock, "left")}
            {header("change", W.cols.price)}
            {columns.map((c) => (
              <Fragment key={c}>{header(c, W.cols[c], "right", W.colHelp[c])}</Fragment>
            ))}
            <th scope="col" className="w-[92px]">
              <span className="sr-only">{W.actions}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Fragment key={r.symbol}>
              <tr className="border-b border-line hover:bg-panel-2/60">
                <th scope="row" className="sticky left-0 z-[1] bg-panel py-2 pl-4 pr-2 text-left font-normal sm:pl-2 max-w-[13rem]">
                  <Link href={`/stock/${encodeURIComponent(r.symbol)}`} prefetch={false} className="block min-h-11 hover:underline">
                    <span className="font-semibold">{r.symbol}</span>
                    <span className="block truncate font-sans text-xs text-muted">{r.view.quote?.name ?? (r.view.error ? t.data.issuesShort[r.view.error] : "")}</span>
                  </Link>
                  {r.tags.length > 0 && (
                    <span className="mt-0.5 flex flex-wrap gap-1 font-sans" aria-label={fill(W.tagsFor, { s: r.symbol })}>
                      {r.tags.map((tag) => (
                        <Badge key={tag}>{tag}</Badge>
                      ))}
                    </span>
                  )}
                </th>
                <td className="py-2 px-2 text-right whitespace-nowrap">
                  <span className="block font-semibold">{r.view.quote ? fmtPrice(r.view.quote.price, lang) : "—"}</span>
                  {r.view.quote ? <Change pct={r.view.quote.changePercent} className="text-xs" /> : <span className="text-xs text-muted">{t.ux.noPrice}</span>}
                  {r.view.stale && (
                    <span className="block">
                      <Badge tone="warn">{t.ux.stale}</Badge>
                    </span>
                  )}
                </td>
                {columns.map((c) => (
                  <td key={c} className="py-2 px-2 text-right align-middle">
                    <Cell column={c} row={r} lang={lang} />
                  </td>
                ))}
                <td className="py-1 pl-1 pr-3 sm:pr-1">
                  <span className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => onEdit(editing === r.symbol ? null : r.symbol)}
                      aria-expanded={editing === r.symbol}
                      className={`grid h-11 w-11 place-items-center rounded-lg hover:bg-panel-2 ${editing === r.symbol ? "text-fg" : "text-muted"}`}
                      aria-label={fill(W.editTags, { s: r.symbol })}
                    >
                      <TagIcon size={18} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(r.symbol)}
                      className="grid h-11 w-11 place-items-center rounded-lg text-muted hover:bg-down-bg hover:text-down"
                      aria-label={fill(t.ux.removeX, { s: r.symbol })}
                    >
                      <CloseIcon size={18} />
                    </button>
                  </span>
                </td>
              </tr>
              {editing === r.symbol && (
                <tr className="border-b border-line bg-panel-2/40">
                  <td colSpan={span} className="px-4 py-3 sm:px-2">
                    <TagEditor symbol={r.symbol} mine={r.tags} all={allTags} onToggle={(tag) => onToggleTag(r.symbol, tag)} onDone={() => onEdit(null)} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TagEditor({ symbol, mine, all, onToggle, onDone }: { symbol: string; mine: string[]; all: string[]; onToggle: (tag: string) => void; onDone: () => void }) {
  const { t } = useI18n();
  const W = t.watch;
  const id = useId();
  const [draft, setDraft] = useState("");
  const options = [...new Set([...all, ...mine])].sort((a, b) => a.localeCompare(b));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const tag = cleanTag(draft);
    if (!tag) return;
    if (!mine.some((m) => m.toLocaleLowerCase() === tag.toLocaleLowerCase())) onToggle(tag);
    setDraft("");
  };
  return (
    <div className="font-sans" role="group" aria-label={fill(W.tagsFor, { s: symbol })}>
      {options.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {options.map((tag) => {
            const on = mine.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(tag)}
                disabled={!on && mine.length >= TAGS_PER_STOCK}
                className={`inline-flex h-11 sm:h-8 items-center rounded-full border px-3 text-[13px] font-medium disabled:opacity-50 ${
                  on ? "border-accent bg-accent/10 text-fg" : "border-line bg-panel text-muted hover:text-fg"
                }`}
              >
                {tag}
              </button>
            );
          })}
        </div>
      )}
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={id} className="control-label mb-1 block">
            {W.newTag}
          </label>
          <input
            id={id}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={24}
            disabled={mine.length >= TAGS_PER_STOCK}
            className="h-11 sm:h-9 w-48 rounded-lg border border-line bg-panel px-3 text-sm"
          />
        </div>
        <button type="submit" className={buttonClass("secondary", true)} disabled={!cleanTag(draft) || mine.length >= TAGS_PER_STOCK}>
          {W.addTag}
        </button>
        <button type="button" onClick={onDone} className={buttonClass("ghost", true, "text-muted")}>
          {W.done}
        </button>
        <span className="basis-full text-xs text-muted">{fill(W.tagHint, { n: TAGS_PER_STOCK })}</span>
      </form>
    </div>
  );
}

// ---- Cells ---------------------------------------------------------------------------------

function Cell({ column, row, lang }: { column: Column; row: Row; lang: Lang }) {
  const { t } = useI18n();
  const W = t.watch;
  const enc = encodeURIComponent(row.symbol);

  if (column === "marketCap") return <>{row.marketCap ? `$${fmtBig(row.marketCap, lang)}` : "—"}</>;

  if (column === "fairValue") {
    if (row.fairValue === null) {
      return (
        <Link href={`/stock/${enc}?tab=research`} prefetch={false} className="link inline-flex min-h-11 min-w-11 items-center justify-end text-xs" aria-label={fill(W.setFairValueTitle, { s: row.symbol })}>
          {W.setFairValue}
        </Link>
      );
    }
    const u = upside(row.fairValue, row.price);
    return (
      <span title={u === null ? undefined : fill(W.fairValueTitle, { v: fmtPrice(row.fairValue, lang), u: pctText(u, lang) })} className="whitespace-nowrap">
        <span className="block">{fmtPrice(row.fairValue, lang)}</span>
        {u !== null && <span className={`block text-xs ${u > 0 ? "text-up" : u < 0 ? "text-down" : "text-muted"}`}>{pctText(u, lang)}</span>}
      </span>
    );
  }

  // SEC columns
  const snap = row.snap;
  if (!snap || snap.status === "loading") return <Skeleton className="ml-auto h-4 w-16" />;
  if (snap.status === "error") return <Muted title={t.data.issuesShort[snap.issue as keyof typeof t.data.issuesShort] ?? t.data.issuesShort.upstream} />;
  const s = snap.data;

  if (column === "quality") {
    if (!s.quality.ok) return <Muted title={t.data.issuesShort[s.quality.error]} />;
    const q = s.quality.data;
    const judged = q.passed + q.failed;
    if (!judged) return <Muted title={W.quality.na} />;
    const tone = q.level === "high" ? "good" : q.level === "mixed" ? "warn" : q.level === "low" ? "bad" : "neutral";
    return (
      <Link
        href={`/stock/${enc}?tab=fundamentals`}
        prefetch={false}
        className="inline-flex min-h-11 flex-col items-end justify-center hover:underline"
        title={fill(W.qualityTitle, { p: q.passed, j: judged, y: q.fiscal ?? "—" })}
      >
        <span>
          {q.passed}/{judged}
        </span>
        <Badge tone={tone}>{W.quality[q.level]}</Badge>
      </Link>
    );
  }

  if (column === "report" || column === "latest") {
    if (!s.filings.ok) return <Muted title={t.data.issuesShort[s.filings.error]} />;
    const f = column === "report" ? s.filings.data.report : s.filings.data.latest;
    if (!f) return <Muted />;
    return <FilingCell f={f} cik={s.cik} symbol={row.symbol} lang={lang} />;
  }

  // insiders
  if (!s.insiders.ok) return <Muted title={t.data.issuesShort[s.insiders.error]} />;
  const ins = s.insiders.data;
  const partial = ins.pending > 0 && (
    <span className="block text-[11px] text-warn" title={fill(W.partialTitle, { n: ins.pending })}>
      {W.partial}
    </span>
  );
  return (
    <Link href={`/stock/${enc}?tab=insiders`} prefetch={false} className="inline-flex min-h-11 flex-col items-end justify-center whitespace-nowrap text-xs hover:underline">
      {ins.bought === 0 && ins.sold === 0 ? (
        <span className="text-muted">{W.noTrades}</span>
      ) : (
        <>
          {ins.bought > 0 && <span className="text-up">{fill(W.bought, { v: `$${fmtBig(ins.bought)}` })}</span>}
          {ins.sold > 0 && <span className="text-muted">{fill(W.sold, { v: `$${fmtBig(ins.sold)}` })}</span>}
        </>
      )}
      {partial}
    </Link>
  );
}

function FilingCell({ f, cik, symbol, lang }: { f: FilingRef; cik: number; symbol: string; lang: Lang }) {
  const { t } = useI18n();
  const W = t.watch;
  const recent = Date.now() - Date.parse(f.filed) < 7 * DAY;
  const items = f.items.filter((i) => i !== "9.01").map((i) => t.filings.items[i] ?? i);
  const readable = f.form === "10-K";
  return (
    <span className="inline-flex flex-col items-end whitespace-nowrap">
      <a href={filingDocUrl(cik, f)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 sm:min-h-8 items-center gap-1 hover:underline">
        <span className="font-medium">{f.form}</span>
        <span className="text-xs text-muted">{fmtDate(f.filed, lang)}</span>
      </a>
      {items.length > 0 && <span className="max-w-[12rem] truncate font-sans text-[11px] text-muted" title={items.join(" · ")}>{items.join(" · ")}</span>}
      <span className="flex items-center gap-1">
        {recent && (
          <span title={W.newTitle}>
            <Badge tone="info">{W.new}</Badge>
          </span>
        )}
        {readable && (
          <Link
            href={`/stock/${encodeURIComponent(symbol)}/report?accn=${encodeURIComponent(f.accn)}`}
            prefetch={false}
            className="link inline-flex min-h-11 sm:min-h-8 items-center gap-1 font-sans text-xs"
            aria-label={fill(W.readTitle, { f: `${f.form} ${fmtDate(f.filed, lang)}` })}
          >
            <FileTextIcon size={13} />
            {W.read}
          </Link>
        )}
      </span>
    </span>
  );
}

function Muted({ title }: { title?: string }) {
  return (
    <span className="text-muted" title={title}>
      —{title && <span className="sr-only"> ({title})</span>}
    </span>
  );
}
