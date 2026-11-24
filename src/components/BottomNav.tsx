"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { ExploreSheet, isExplorePath } from "./ExploreMenu";
import { CanvasIcon, MoreIcon, NotebookIcon, SlidersIcon, StarIcon } from "./icons";

/** Phone navigation. Hidden while a text field has focus, so it never rides on the keyboard. */
export default function BottomNav() {
  const { t } = useI18n();
  const path = usePathname();
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const isField = (el: EventTarget | null) =>
      el instanceof HTMLElement &&
      (el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.isContentEditable);
    const onIn = (e: FocusEvent) => setTyping(isField(e.target));
    const onOut = () => setTyping(false);
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);
  const [exploring, setExploring] = useState(false);
  const items = [
    { href: "/", label: t.nav.home, Icon: NotebookIcon, active: path === "/" || path.startsWith("/research") },
    { href: "/canvas", label: t.nav.canvas, Icon: CanvasIcon, active: path.startsWith("/canvas") },
    { href: "/watchlist", label: t.nav.watchlist, Icon: StarIcon, active: path.startsWith("/watchlist") },
    { href: "/screener", label: t.nav.screener, Icon: SlidersIcon, active: path.startsWith("/screener") },
  ];
  const exploreActive = exploring || isExplorePath(path);
  return (
    <>
      {/* Outside the bar: its backdrop blur would trap a fixed sheet inside it. */}
      <ExploreSheet open={exploring} onClose={() => setExploring(false)} />
      <nav
        aria-label={t.ux.mainNav}
        className={`md:hidden fixed bottom-0 inset-x-0 z-30 bg-bg border-t border-line pb-[env(safe-area-inset-bottom)] ${typing ? "hidden" : ""}`}
      >
        <ul className="grid grid-cols-5">
          {items.map(({ href, label, Icon, active }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`relative flex flex-col items-center justify-center h-14 text-[11px] gap-1 ${active ? "text-fg font-semibold" : "text-muted"}`}
              >
                {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-fg" aria-hidden="true" />}
                <Icon size={22} />
                {label}
              </Link>
            </li>
          ))}
          <li>
            <button
              type="button"
              aria-expanded={exploring}
              onClick={() => setExploring((v) => !v)}
              className={`relative flex h-14 w-full flex-col items-center justify-center gap-1 text-[11px] ${exploreActive ? "text-fg font-semibold" : "text-muted"}`}
            >
              {exploreActive && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-fg" aria-hidden="true" />}
              <MoreIcon size={22} />
              {t.nav.explore}
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
