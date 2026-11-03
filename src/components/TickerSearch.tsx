"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import type { SearchResult } from "@/lib/types";

export default function TickerSearch({ autoFocus = false, large = false }: { autoFocus?: boolean; large?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);

  // "/" focuses the search (desktop keyboards). Only the header instance listens.
  useEffect(() => {
    if (large) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [large]);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        const data: SearchResult[] = res.ok ? await res.json() : [];
        setResults(data);
        setActive(0);
      } catch {
        /* aborted */
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q]);

  const go = (symbol: string) => {
    setOpen(false);
    setQ("");
    inputRef.current?.blur();
    router.push(`/stock/${encodeURIComponent(symbol)}`);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = results[active]?.symbol ?? q.trim().toUpperCase();
      if (/^[A-Z][A-Z.\-]{0,9}$/.test(pick)) go(pick);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const listId = `${id}-list`;
  const showList = open && q.trim().length > 0;

  return (
    <div className="relative w-full">
      <label htmlFor={`${id}-input`} className="sr-only">{t.nav.search}</label>
      <div className="relative">
        <span aria-hidden="true" className={`absolute left-3 top-1/2 -translate-y-1/2 text-muted ${large ? "text-lg" : ""}`}>⌕</span>
        <input
          ref={inputRef}
          id={`${id}-input`}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && results[active] ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          enterKeyHint="search"
          autoFocus={autoFocus}
          value={q}
          placeholder={t.search.placeholder}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          className={`w-full rounded-lg border border-line bg-panel pl-9 pr-3 text-base placeholder:text-muted focus:border-accent outline-none ${
            large ? "h-14 text-lg" : "h-10"
          }`}
        />
        {!large && (
          <kbd className="hidden lg:block absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted border border-line rounded px-1.5 py-0.5">
            /
          </kbd>
        )}
      </div>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-40 mt-1 w-full max-h-80 overflow-auto rounded-lg border border-line bg-panel shadow-xl"
        >
          {results.length === 0 && !loading && <li className="px-3 py-3 text-sm text-muted">{t.search.noResults}</li>}
          {results.map((r, i) => (
            <li
              key={r.symbol}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                go(r.symbol);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer min-h-11 ${i === active ? "bg-panel-2" : ""}`}
            >
              <span className="num font-bold text-accent w-16 shrink-0">{r.symbol}</span>
              <span className="truncate text-sm">{r.name}</span>
              {r.exchange && <span className="ml-auto text-[10px] text-muted shrink-0">{r.exchange}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
