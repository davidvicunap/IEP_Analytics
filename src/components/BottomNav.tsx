"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { ChartIcon, HomeIcon, NotebookIcon, SlidersIcon, StarIcon } from "./icons";

/** Phone navigation. Hidden while a text field has focus, so it never rides on the keyboard. */
export default function BottomNav() {
  const { t } = useI18n();
  const path = usePathname();
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const isField = (el: EventTarget | null) => el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    const onIn = (e: FocusEvent) => setTyping(isField(e.target));
    const onOut = () => setTyping(false);
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);
  const items = [
    { href: "/", label: t.nav.home, Icon: HomeIcon, active: path === "/" },
    { href: "/charts", label: t.nav.charts, Icon: ChartIcon, active: path.startsWith("/charts") },
    { href: "/screener", label: t.nav.screener, Icon: SlidersIcon, active: path.startsWith("/screener") },
    { href: "/watchlist", label: t.nav.watchlist, Icon: StarIcon, active: path.startsWith("/watchlist") },
    { href: "/research", label: t.nav.research, Icon: NotebookIcon, active: path.startsWith("/research") },
  ];
  return (
    <nav
      aria-label={t.ux.mainNav}
      className={`md:hidden fixed bottom-0 inset-x-0 z-30 bg-panel/90 backdrop-blur-md border-t border-line pb-[env(safe-area-inset-bottom)] ${typing ? "hidden" : ""}`}
    >
      <ul className="grid grid-cols-5">
        {items.map(({ href, label, Icon, active }) => (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={`relative flex flex-col items-center justify-center h-14 text-[11px] gap-1 ${active ? "text-fg font-medium" : "text-muted"}`}
            >
              <Icon size={22} className={active ? "text-accent" : ""} />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
