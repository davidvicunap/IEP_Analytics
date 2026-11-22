"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { CalendarIcon, ChartIcon, ChevronDownIcon, CloseIcon, ColumnsIcon, FileTextIcon, GridIcon, SearchIcon, SlidersIcon, StarIcon } from "./icons";

/** The tools beyond your own lists: one place to find them, each with what it's for. */
export const EXPLORE = [
  { key: "watchlist", href: "/watchlist", Icon: StarIcon },
  { key: "screener", href: "/screener", Icon: SlidersIcon },
  { key: "compare", href: "/compare", Icon: ColumnsIcon },
  { key: "calendar", href: "/calendar", Icon: CalendarIcon },
  { key: "charts", href: "/charts", Icon: ChartIcon },
  { key: "packs", href: "/charts/packs", Icon: GridIcon },
  { key: "methodology", href: "/methodology", Icon: FileTextIcon },
] as const;

export const isExplorePath = (path: string) => EXPLORE.some((e) => path === e.href || path.startsWith(`${e.href}/`) || (e.href === "/charts" && path.startsWith("/charts")));

/** Opens the command palette (it lives in the header). */
export const openPalette = () => window.dispatchEvent(new Event("iep-palette"));

function Items({ onPick }: { onPick: () => void }) {
  const { t } = useI18n();
  const path = usePathname();
  return (
    <ul className="grid gap-1 sm:grid-cols-2">
      {EXPLORE.map(({ key, href, Icon }) => {
        const item = t.explore.items[key];
        const active = path === href;
        return (
          <li key={key}>
            <Link href={href} onClick={onPick} aria-current={active ? "page" : undefined} className={`flex min-h-12 items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-panel-2 ${active ? "bg-accent-soft" : ""}`}>
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent" aria-hidden="true">
                <Icon size={16} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{item.name}</span>
                <span className="block text-xs text-muted">{item.desc}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Desktop: a menu button in the header nav. */
export function ExploreMenu() {
  const { t } = useI18n();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const active = isExplorePath(path);
  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-9 items-center gap-1 rounded-md px-3 text-[14px] transition-colors ${active ? "bg-accent-soft font-medium text-accent" : open ? "bg-panel-2 font-medium text-fg" : "text-muted hover:text-fg hover:bg-panel-2"}`}
      >
        {t.nav.explore}
        <ChevronDownIcon size={14} className={open ? "rotate-180" : ""} />
      </button>
      {open && (
        <div id={id} className="absolute right-0 top-full z-40 mt-2 w-[34rem] rounded-2xl border border-line bg-panel p-2 shadow-pop">
          <Items onPick={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

/** Phone: a sheet above the bottom bar, with the tools and the command palette. */
export function ExploreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const path = usePathname();
  useEffect(() => onClose(), [path]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="md:hidden fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={t.explore.title}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-auto rounded-t-2xl border-t border-line bg-panel p-3 pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
        <div className="mb-1 flex items-center justify-between px-2">
          <h2 className="text-base font-semibold">{t.explore.title}</h2>
          <button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-lg text-muted hover:bg-panel-2" aria-label={t.explore.close}>
            <CloseIcon size={18} />
          </button>
        </div>
        <Items onPick={onClose} />
        <button
          type="button"
          onClick={() => {
            onClose();
            openPalette();
          }}
          className="mt-1 flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-panel-2"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line text-muted" aria-hidden="true">
            <SearchIcon size={16} />
          </span>
          <span className="text-sm font-medium">{t.explore.commands}</span>
        </button>
      </div>
    </div>
  );
}
