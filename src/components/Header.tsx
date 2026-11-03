"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import TickerSearch from "./TickerSearch";
import { LangToggle, ThemeToggle } from "./Toggles";

export default function Header({ demo }: { demo: boolean }) {
  const { t } = useI18n();
  return (
    <header className="sticky top-0 z-30 bg-bg/90 backdrop-blur border-b border-line pt-[env(safe-area-inset-top)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
        <Link href="/" className="flex items-center gap-2 shrink-0 font-bold tracking-tight" aria-label="IEP Analytics">
          <svg width="26" height="26" viewBox="0 0 64 64" aria-hidden="true">
            <rect width="64" height="64" rx="14" className="fill-panel-2" />
            <path d="M12 44 L26 30 L35 38 L52 18" stroke="var(--accent)" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="hidden sm:inline">
            IEP <span className="text-accent">Analytics</span>
          </span>
        </Link>
        <div className="flex-1 min-w-0">
          <TickerSearch />
        </div>
        <nav className="hidden md:flex items-center gap-1 text-sm">
          <Link href="/watchlist" className="px-3 py-2 rounded-md hover:bg-panel-2">{t.nav.watchlist}</Link>
        </nav>
        <LangToggle />
        <ThemeToggle />
      </div>
      {demo && (
        <p role="status" className="text-xs text-center py-1 bg-warn-bg text-warn border-t border-line px-4">
          {t.app.demo}
        </p>
      )}
    </header>
  );
}
