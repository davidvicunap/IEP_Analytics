"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fill, useI18n } from "@/lib/i18n";
import { SearchController, TICKER, normalizeTerm, type SearchState } from "@/lib/search";
import { CloseIcon, SearchIcon } from "./icons";

// One controller (and cache) for every search box on the page.
let shared: SearchController | null = null;
const controller = () => (shared ??= new SearchController());

/**
 * Accessible combobox (ARIA 1.2 pattern) for companies and tickers.
 * Keyboard: ↓/↑ move, Enter opens, Escape closes (then clears), Tab leaves.
 * Pointer and touch: tap a result. Focus stays in the field while choosing.
 */
export default function TickerSearch({
  autoFocus = false,
  large = false,
  onDone,
  onEscape,
  onSelect,
  placeholder,
  label,
}: {
  autoFocus?: boolean;
  large?: boolean;
  onDone?: () => void;
  onEscape?: () => void;
  /** Pick a symbol instead of opening its page (e.g. adding a company to a chart). */
  onSelect?: (symbol: string) => void;
  placeholder?: string;
  label?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [q, setQ] = useState("");
  const [state, setState] = useState<SearchState>(() => controller().state);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const pendingEnter = useRef<string | null>(null);

  const go = (symbol: string) => {
    pendingEnter.current = null;
    setOpen(false);
    setQ("");
    controller().setQuery("");
    inputRef.current?.blur();
    onDone?.();
    if (onSelect) {
      onSelect(symbol);
      inputRef.current?.focus();
      return;
    }
    router.push(`/stock/${encodeURIComponent(symbol)}`);
  };

  useEffect(() => {
    const c = controller();
    return c.subscribe((s) => {
      setState(s);
      setActive(-1); // new answer, new list: nothing pre-selected
      // Enter was pressed while this query was loading: finish the job now.
      const want = pendingEnter.current;
      if (want && normalizeTerm(want) === s.term && s.status !== "loading") {
        const target = s.status === "success" ? c.resolveEnter(want, -1) : TICKER.test(s.term.toUpperCase()) ? s.term.toUpperCase() : null;
        pendingEnter.current = null;
        if (target && target !== "wait") go(target);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // This box's own view of the shared state: only what matches its text counts.
  const mine = normalizeTerm(q) === state.term ? state : null;
  const results = mine?.status === "success" ? mine.results : [];
  const showList = open && normalizeTerm(q).length > 0;

  useEffect(() => {
    if (active < 0) return;
    document.getElementById(`${id}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, id]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      if (results.length) setActive((a) => (a + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length) setActive((a) => (a <= 0 ? results.length - 1 : a - 1));
    } else if (e.key === "Home" && showList && active >= 0) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && showList && active >= 0) {
      e.preventDefault();
      setActive(results.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = controller().resolveEnter(q, active);
      if (target === "wait") pendingEnter.current = q;
      else if (target) go(target);
      else if (mine?.status === "error") controller().retry(); // Enter retries a failed search
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (showList) setOpen(false);
      else if (q) {
        setQ("");
        controller().setQuery("");
      } else onEscape?.();
    }
  };

  const listId = `${id}-list`;
  const statusText = !normalizeTerm(q)
    ? ""
    : !mine || mine.status === "loading"
      ? t.search.loading
      : mine.status === "success"
        ? fill(results.length === 1 ? t.search.oneResult : t.search.nResults, { n: results.length })
        : mine.status === "empty"
          ? fill(t.search.noResultsFor, { q: normalizeTerm(q) })
          : t.search.errors[mine.error ?? "unavailable"];

  return (
    <div
      className="relative w-full"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <label htmlFor={`${id}-input`} className="sr-only">
        {label ?? t.search.label}
      </label>
      <div className="relative">
        <SearchIcon size={large ? 22 : 18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          ref={inputRef}
          id={`${id}-input`}
          data-search-input=""
          type="text"
          inputMode="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-describedby={`${id}-hint`}
          aria-activedescendant={showList && active >= 0 && results[active] ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          enterKeyHint="search"
          autoFocus={autoFocus}
          value={q}
          placeholder={placeholder ?? t.search.placeholder}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(-1);
            pendingEnter.current = null;
            controller().setQuery(e.target.value);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={`w-full rounded-lg border border-line bg-panel pl-10 pr-11 placeholder:text-muted focus:border-accent outline-none focus-visible:outline-2 focus-visible:outline-accent ${
            large ? "h-14 text-lg" : "h-11 text-base"
          }`}
        />
        {q ? (
          <button
            type="button"
            aria-label={t.search.clear}
            onClick={() => {
              setQ("");
              controller().setQuery("");
              inputRef.current?.focus();
            }}
            className="absolute right-1 top-1/2 -translate-y-1/2 grid h-10 w-10 place-items-center rounded-md text-muted hover:text-fg"
          >
            <CloseIcon size={18} />
          </button>
        ) : (
          !large && (
            <kbd className="hidden lg:block absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted border border-line rounded px-1.5 py-0.5" aria-hidden="true">
              /
            </kbd>
          )
        )}
      </div>
      <span id={`${id}-hint`} className="sr-only">
        {t.search.hint}
      </span>
      <span role="status" className="sr-only">
        {open ? statusText : ""}
      </span>
      {showList && (
        <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-lg border border-line bg-panel shadow-xl">
          <ul id={listId} ref={listRef} role="listbox" aria-label={t.search.results} className="max-h-80 overflow-auto">
            {results.map((r, i) => (
              <li
                key={r.symbol}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                // Keep focus in the field so the list doesn't close before the tap lands.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(r.symbol)}
                onMouseMove={() => active !== i && setActive(i)}
                className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer min-h-12 ${i === active ? "bg-panel-2" : ""}`}
              >
                <span className="font-semibold text-fg w-16 shrink-0">{r.symbol}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{r.name}</span>
                {r.exchange && <span className="text-[10px] text-muted shrink-0">{r.exchange}</span>}
              </li>
            ))}
          </ul>
          {results.length === 0 && (
            <div className="px-3 py-3 text-sm text-muted" aria-hidden="true">
              {mine?.status === "error" ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{t.search.errors[mine.error ?? "unavailable"]}</span>
                  {mine.error !== "beta_expired" && (
                    <button
                      type="button"
                      tabIndex={-1}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => controller().retry()}
                      className="h-9 px-3 rounded-md border border-line text-xs font-semibold text-fg"
                    >
                      {t.errors.retry}
                    </button>
                  )}
                </div>
              ) : mine?.status === "empty" ? (
                <>
                  <p>{fill(t.search.noResultsFor, { q: normalizeTerm(q) })}</p>
                  <p className="mt-1 text-xs">
                    {TICKER.test(normalizeTerm(q).toUpperCase()) ? fill(t.search.openTicker, { s: normalizeTerm(q).toUpperCase() }) : t.search.tryTicker}
                  </p>
                </>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full border-2 border-muted border-t-transparent animate-spin motion-reduce:animate-none" />
                  {t.search.loading}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
