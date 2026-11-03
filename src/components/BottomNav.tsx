"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n";

export default function BottomNav() {
  const { t } = useI18n();
  const path = usePathname();
  const items = [
    { href: "/", label: t.nav.home, icon: "⌂" },
    { href: "/watchlist", label: t.nav.watchlist, icon: "☆" },
  ];
  return (
    <nav
      aria-label="Main"
      className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-panel/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="grid grid-cols-2">
        {items.map((i) => {
          const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center justify-center h-14 text-xs gap-0.5 ${active ? "text-accent" : "text-muted"}`}
              >
                <span aria-hidden="true" className="text-lg leading-none">{i.icon}</span>
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
