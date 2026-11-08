"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { HomeIcon, StarIcon } from "./icons";

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
    { href: "/watchlist", label: t.nav.watchlist, Icon: StarIcon, active: path.startsWith("/watchlist") },
  ];
  return (
    <nav
      aria-label={t.ux.mainNav}
      className={`md:hidden fixed bottom-0 inset-x-0 z-30 bg-panel/95 backdrop-blur-sm border-t border-line pb-[env(safe-area-inset-bottom)] ${typing ? "hidden" : ""}`}
    >
      <ul className="grid grid-cols-2">
        {items.map(({ href, label, Icon, active }) => (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={`relative flex flex-col items-center justify-center h-14 text-xs gap-0.5 ${active ? "text-accent font-semibold" : "text-muted"}`}
            >
              {active && <span className="absolute top-0 h-0.5 w-10 rounded-b bg-accent" aria-hidden="true" />}
              <Icon size={22} />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
