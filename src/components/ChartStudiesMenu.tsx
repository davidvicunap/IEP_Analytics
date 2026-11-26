"use client";

import { useEffect, useId, useRef, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { CHART_STUDIES, MAX_STUDIES, toggleStudy } from "@/lib/chartStudies";
import { studiesStore, useChartStudies } from "@/lib/chartStudiesClient";
import { ChevronDownIcon } from "./icons";
import { buttonClass } from "./ui";

/**
 * The indicators every TradingView chart opens with (on the stock page and in your canvases),
 * saved to your account: one small button that opens the list, instead of a wall of chips.
 */
export default function ChartStudiesMenu({ align = "right" }: { align?: "left" | "right" }) {
  const { t } = useI18n();
  const C = t.chart.studies;
  const list = useChartStudies();
  const full = list.length >= MAX_STUDIES;
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={box}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className={buttonClass("secondary", true, open ? "bg-panel-2" : "")}
        data-testid="studies-menu"
      >
        {C.menu}
        {list.length > 0 && <span className="num rounded bg-panel-2 px-1.5 text-xs text-muted">{list.length}</span>}
        <ChevronDownIcon size={14} className={open ? "rotate-180" : ""} />
      </button>
      {open && (
        <div
          id={id}
          className={`absolute top-full z-40 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-line bg-panel p-3 shadow-pop ${align === "right" ? "right-0" : "left-0"}`}
        >
          <fieldset>
            <legend className="text-[13px] font-medium">{C.title}</legend>
            <ul className="mt-1.5 grid grid-cols-1 sm:grid-cols-2">
              {CHART_STUDIES.map((s) => {
                const on = list.includes(s);
                return (
                  <li key={s}>
                    <label className={`flex min-h-11 items-center gap-2.5 rounded-md px-1.5 text-sm sm:min-h-9 ${!on && full ? "text-muted" : "cursor-pointer hover:bg-panel-2"}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!on && full}
                        onChange={() => studiesStore.write(toggleStudy(list, s))}
                        className="h-4 w-4 accent-[var(--text)]"
                      />
                      {C.names[s]}
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
          <p className="mt-2 text-xs leading-relaxed text-muted" role="status">
            {full ? fill(C.full, { n: MAX_STUDIES }) : C.note}
          </p>
        </div>
      )}
    </div>
  );
}
