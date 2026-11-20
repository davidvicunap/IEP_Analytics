"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fill, useI18n } from "@/lib/i18n";
import { PAGES, commandsFor, hrefFor, parse, type Command } from "@/lib/commands";
import { SearchController, normalizeTerm, type SearchState } from "@/lib/search";
import { useRecent, useWatchlist } from "@/lib/watchlist";
import { ChartIcon, ChevronRightIcon, GridIcon, MoonIcon, SearchIcon, StarIcon, SunIcon } from "./icons";
import { applyTheme } from "./Toggles";
import { toast } from "./ui";

// Its own search (and cache), separate from the search boxes on the page.
let shared: SearchController | null = null;
const controller = () => (shared ??= new SearchController());

const STOCK_PAGE = /^\/stock\/([^/]+)/;

/**
 * Ctrl/⌘+K: one box for going anywhere and doing the common things ("AAPL valuation", "follow
 * KO", "dark"). Words are matched in the browser; only company names are searched. A modal
 * dialog with a combobox: arrows move, Enter runs, Escape closes and focus returns where it was.
 */
export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang, setLang } = useI18n();
  const P = t.palette;
  const router = useRouter();
  const path = usePathname();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [search, setSearch] = useState<SearchState>(() => controller().state);
  const watch = useWatchlist();
  const recent = useRecent();
  const symbol = path.match(STOCK_PAGE)?.[1] ? decodeURIComponent(path.match(STOCK_PAGE)![1]).toUpperCase() : undefined;

  useEffect(() => controller().subscribe(setSearch), []);

  // Open: remember the focus, start empty; close: give the focus back.
  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement as HTMLElement | null;
    setQ("");
    setActive(0);
    controller().setQuery("");
    requestAnimationFrame(() => inputRef.current?.focus());
    // Escape closes even before the field has the focus.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      returnTo.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { rest, alt } = parse(q);
  const company = normalizeTerm(rest || alt || "");
  useEffect(() => {
    if (open) controller().setQuery(company);
  }, [company, open]);

  const results = search.term === company && search.status === "success" ? search.results.slice(0, 5) : [];
  const searching = !!company && (search.term !== company || search.status === "loading");
  const items = useMemo(
    () => commandsFor(q, { symbol, recent: recent.list, following: watch.list, results: results.map((r) => ({ symbol: r.symbol, name: r.name })) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, symbol, recent.list, watch.list, results.map((r) => r.symbol).join(",")],
  );
  useEffect(() => setActive((a) => Math.min(a, Math.max(0, items.length - 1))), [items.length]);
  useEffect(() => {
    document.getElementById(`${id}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, id]);

  if (!open) return null;

  const run = (c: Command) => {
    onClose();
    if (c.type === "stock") router.push(hrefFor(c));
    else if (c.type === "page") router.push(PAGES[c.page].href);
    else if (c.type === "setting") {
      if (c.setting === "dark" || c.setting === "light") applyTheme(c.setting);
      else if (c.setting !== lang) setLang(c.setting);
    } else {
      if (c.on) watch.add(c.symbol);
      else watch.remove(c.symbol);
      toast({ message: fill(c.on ? P.followed : P.unfollowed, { s: c.symbol }) });
    }
  };

  const label = (c: Command): { main: string; sub?: string } => {
    if (c.type === "stock") return { main: c.section === "overview" ? c.symbol : `${c.symbol} · ${P.sections[c.section]}`, sub: c.name };
    if (c.type === "follow") return { main: fill(c.on ? P.follow : P.unfollow, { s: c.symbol }), sub: c.name };
    if (c.type === "page") return { main: P.pages[c.page] };
    return { main: P.settings[c.setting] };
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length) setActive((a) => (a + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length) setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[active]) run(items[active]);
    } else if (e.key === "Tab") {
      e.preventDefault(); // the field is the only stop in the dialog
    }
  };

  const listId = `${id}-list`;
  const status = searching ? P.searching : items.length ? fill(P.count, { n: items.length }) : q.trim() ? fill(P.empty, { q: q.trim() }) : "";

  // On <body>: the header's backdrop blur would otherwise trap a fixed overlay inside it.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[12vh] sm:pt-[15vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        <h2 id={`${id}-title`} className="sr-only">
          {P.title}
        </h2>
        <div className="relative border-b border-line">
          <SearchIcon size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
          <input
            ref={inputRef}
            autoFocus
            type="text"
            role="combobox"
            aria-label={P.label}
            aria-expanded={items.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={items[active] ? `${id}-opt-${active}` : undefined}
            aria-describedby={`${id}-hint`}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={q}
            placeholder={P.placeholder}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="h-14 w-full bg-transparent pl-11 pr-4 text-base outline-none placeholder:text-muted"
          />
        </div>
        <span id={`${id}-hint`} className="sr-only">
          {P.hint}
        </span>
        <span role="status" className="sr-only">
          {status}
        </span>
        <ul id={listId} role="listbox" aria-label={P.title} className="max-h-[50vh] overflow-auto p-1.5">
          {items.map((c, i) => {
            const l = label(c);
            return (
              <li
                key={`${i}-${JSON.stringify(c)}`}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(c)}
                onMouseMove={() => active !== i && setActive(i)}
                className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ${i === active ? "bg-panel-2" : ""}`}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line text-muted" aria-hidden="true">
                  <KindIcon c={c} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{l.main}</span>
                  {l.sub && <span className="block truncate text-xs text-muted">{l.sub}</span>}
                </span>
                <span className="shrink-0 text-[11px] text-muted">{P.kinds[c.type]}</span>
                {i === active && <ChevronRightIcon size={14} className="shrink-0 text-muted" aria-hidden="true" />}
              </li>
            );
          })}
        </ul>
        {items.length === 0 && (
          <div className="px-4 pb-4 pt-2 text-sm text-muted">
            {searching ? (
              P.searching
            ) : q.trim() ? (
              <>
                <p>{fill(P.empty, { q: q.trim() })}</p>
                <p className="mt-1 text-xs">{P.emptyHint}</p>
              </>
            ) : null}
          </div>
        )}
        <p className="hidden border-t border-line px-4 py-2 text-[11px] text-muted sm:block" aria-hidden="true">
          {P.hint}
        </p>
      </div>
    </div>,
    document.body,
  );
}

function KindIcon({ c }: { c: Command }) {
  if (c.type === "follow") return <StarIcon size={15} />;
  if (c.type === "setting") return c.setting === "dark" ? <MoonIcon size={15} /> : c.setting === "light" ? <SunIcon size={15} /> : <span className="text-[11px] font-semibold">{c.setting.toUpperCase()}</span>;
  if (c.type === "page") return <GridIcon size={15} />;
  if (c.section === "chart" || c.section === "packs") return <ChartIcon size={15} />;
  return <span className="text-[10px] font-semibold">{c.symbol.slice(0, 4)}</span>;
}
