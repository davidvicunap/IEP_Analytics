"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import TickerSearch from "./TickerSearch";
import { CloseIcon, LogoMark, SearchIcon } from "./icons";
import { LangToggle, ThemeToggle } from "./Toggles";

/** True when the event comes from a place where typing "/" or "k" means text. */
export function isTypingTarget(e: KeyboardEvent): boolean {
  if (e.isComposing || e.keyCode === 229) return true; // IME composition
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable || !!el.closest?.("[contenteditable]:not([contenteditable=false])");
}

const iconBtn = "grid h-11 w-11 place-items-center rounded-lg text-muted hover:text-fg hover:bg-panel-2";

export default function Header({ demo }: { demo: boolean }) {
  const { t } = useI18n();
  const path = usePathname();
  const onHome = path === "/";
  const [open, setOpen] = useState(false); // narrow-screen search panel
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close the panel on navigation.
  useEffect(() => setOpen(false), [path]);

  // "/" and Ctrl/Cmd+K go to the search that's on screen: the page's main search, the
  // header field on wide screens, or the search panel on narrow ones.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const isSlash = e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey;
      const isK = k === "k" && (e.metaKey || e.ctrlKey) && !e.altKey;
      if (!isSlash && !isK) return;
      if (isSlash && isTypingTarget(e)) return;
      if (isK && e.isComposing) return;
      const visible = [...document.querySelectorAll<HTMLInputElement>("[data-search-input]")].find((el) => el.offsetParent !== null);
      e.preventDefault();
      if (visible) {
        visible.focus();
        visible.select();
      } else setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <header className="sticky top-0 z-30 bg-bg/90 backdrop-blur-md border-b border-line pt-[env(safe-area-inset-top)]">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 h-14 flex items-center gap-2 sm:gap-3 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
        <Link href="/" className="flex items-center gap-2 shrink-0 min-h-11 text-[15px] font-semibold tracking-[-0.01em]" aria-label="IEP Analytics">
          <LogoMark size={24} />
          <span className="hidden sm:inline">
            IEP <span className="text-muted font-medium">Analytics</span>
          </span>
        </Link>
        <div className="flex-1 min-w-0">
          {!onHome && (
            <div className="hidden md:block max-w-xl">
              <TickerSearch />
            </div>
          )}
        </div>
        <nav aria-label={t.ux.mainNav} className="hidden md:flex items-center gap-1 text-sm">
          <NavLink href="/" active={onHome}>
            {t.nav.home}
          </NavLink>
          <NavLink href="/charts" active={path.startsWith("/charts")}>
            {t.nav.charts}
          </NavLink>
          <NavLink href="/watchlist" active={path.startsWith("/watchlist")}>
            {t.nav.watchlist}
          </NavLink>
          <NavLink href="/research" active={path.startsWith("/research")}>
            {t.nav.research}
          </NavLink>
        </nav>
        {!onHome && (
          <button
            ref={triggerRef}
            type="button"
            className={`${iconBtn} md:hidden`}
            aria-label={t.nav.search}
            aria-expanded={open}
            aria-controls="mobile-search"
            onClick={() => (open ? close() : setOpen(true))}
          >
            {open ? <CloseIcon /> : <SearchIcon />}
          </button>
        )}
        <div className="flex items-center gap-0.5">
          <LangToggle />
          <ThemeToggle />
        </div>
      </div>
      {open && !onHome && (
        <div id="mobile-search" className="md:hidden border-t border-line px-3 py-2 bg-bg">
          <TickerSearch autoFocus onDone={() => setOpen(false)} onEscape={close} />
        </div>
      )}
      {demo && (
        <p role="note" className="flex items-center justify-center gap-2 text-xs py-1.5 border-t border-line px-4 text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-hidden="true" />
          {t.app.demo}
        </p>
      )}
    </header>
  );
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center h-9 px-3 rounded-md text-[14px] transition-colors ${
        active ? "bg-panel-2 text-fg font-medium" : "text-muted hover:text-fg"
      }`}
    >
      {children}
    </Link>
  );
}
