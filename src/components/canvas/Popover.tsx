"use client";

import { useEffect, useRef } from "react";

/**
 * A small floating panel under its trigger: closes on Escape and on a press outside, and gives
 * focus back to the trigger. On phones `sheet` turns it into a bottom sheet.
 */
export default function Popover({
  open,
  onClose,
  label,
  className = "",
  sheet = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  className?: string;
  sheet?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        trigger?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const el = ref.current;
      if (el && !el.contains(e.target as Node) && !(trigger && trigger.contains(e.target as Node))) onClose();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      data-nodrag
      className={`z-40 border border-line bg-panel shadow-pop ${
        sheet
          ? "fixed inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-lg pb-[env(safe-area-inset-bottom)] sm:absolute sm:inset-x-auto sm:bottom-auto sm:top-full sm:mt-2 sm:max-h-[70vh] sm:rounded-lg sm:pb-0"
          : "absolute top-full mt-1.5 rounded-lg"
      } ${className}`}
    >
      {children}
    </div>
  );
}
