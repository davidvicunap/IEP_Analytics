"use client";

import { useEffect, useId, useState } from "react";

/** "12,5" or "12.5" → 12.5; empty or invalid → null. */
export function parseNumber(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (t === "" || t === "-" || t === ".") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const show = (v: number | null, scale: number, digits: number) =>
  v === null || !Number.isFinite(v) ? "" : String(Math.round(v * scale * 10 ** digits) / 10 ** digits);

/**
 * A number input that keeps what the user is typing (e.g. "12.") and reports the parsed value.
 * `scale` converts between stored and shown values: 100 for percentages stored as fractions.
 * It re-syncs from `value` when the parent changes it (reset, load scenario, copy row).
 */
export function NumberField({
  label,
  value,
  onChange,
  scale = 1,
  digits = 2,
  suffix,
  srLabel = false,
  placeholder,
  className = "",
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  scale?: number;
  digits?: number;
  suffix?: string;
  srLabel?: boolean; // label only for screen readers (inside tables)
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  const [text, setText] = useState(() => show(value, scale, digits));
  useEffect(() => {
    const parsed = parseNumber(text);
    const current = parsed === null ? null : parsed / scale;
    if (value === null ? text !== "" && current !== null : current === null || Math.abs(current - value) > 1e-9) {
      setText(show(value, scale, digits));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only external changes matter here
  }, [value]);
  const invalid = text.trim() !== "" && parseNumber(text) === null;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className={srLabel ? "sr-only" : "text-[11px] text-muted leading-tight"}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            setText(e.target.value);
            const n = parseNumber(e.target.value);
            onChange(n === null ? null : n / scale);
          }}
          className={`num h-11 sm:h-9 w-full min-w-16 rounded-md border bg-panel px-2 text-sm text-right ${suffix ? "pr-6" : ""} ${invalid ? "border-down" : "border-line"}`}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted" aria-hidden="true">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}
