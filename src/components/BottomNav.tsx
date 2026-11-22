"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { ExploreSheet, isExplorePath } from "./ExploreMenu";
import { GridIcon, HomeIcon, NotebookIcon } from "./icons";

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
    { href: "/", label: t.nav.home, Icon: HomeIcon, active: path === "/" },
    {
      href: "/research",
      label: t.nav.research,
      Icon: NotebookIcon,
      active: path.startsWith("/research"),
    },
  ];
  const exploreActive = exploring || isExplorePath(path);
  return (
    <>
      {/* Outside the bar: its backdrop blur would trap a fixed sheet inside it. */}
      <ExploreSheet open={exploring} onClose={() => setExploring(false)} />
      <nav
        aria-label={t.ux.mainNav}
        className={`md:hidden fixed bottom-0 inset-x-0 z-30 bg-panel/90 backdrop-blur-md border-t border-line pb-[env(safe-area-inset-bottom)] ${typing ? "hidden" : ""}`}
      >
        <ul className="grid grid-cols-3">
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
          <li>
            <button
              type="button"
              aria-expanded={exploring}
              onClick={() => setExploring((v) => !v)}
              className={`relative flex h-14 w-full flex-col items-center justify-center gap-1 text-[11px] ${exploreActive ? "text-fg font-medium" : "text-muted"}`}
            >
              <GridIcon
                size={22}
                className={exploreActive ? "text-accent" : ""}
              />
              {t.nav.explore}
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
