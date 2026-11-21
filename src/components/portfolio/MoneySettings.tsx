"use client";

// The user's currency and whether their broker sells fractions of a share (the synced `risk`
// setting): used by the portfolio totals and by position sizing.
import { useId } from "react";
import { useI18n } from "@/lib/i18n";
import { CURRENCIES, type Currency } from "@/lib/money";
import { riskStore, useRisk } from "@/lib/riskClient";

export default function MoneySettings({ fractions = true }: { fractions?: boolean }) {
  const { t } = useI18n();
  const P = t.portfolio;
  const risk = useRisk();
  const id = useId();
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div>
        <label htmlFor={`${id}-c`} className="control-label mb-1.5 block">
          {P.money}
        </label>
        <select id={`${id}-c`} value={risk.currency} onChange={(e) => riskStore.write({ ...risk, currency: e.target.value as Currency })} className="h-11 rounded-lg border border-line bg-panel px-2 text-sm sm:h-9">
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      {fractions && (
        <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
          <input type="checkbox" checked={risk.fractions} onChange={(e) => riskStore.write({ ...risk, fractions: e.target.checked })} className="h-5 w-5 accent-[var(--accent)]" />
          {P.fractions}
        </label>
      )}
    </div>
  );
}
