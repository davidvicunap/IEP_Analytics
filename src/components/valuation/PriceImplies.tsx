"use client";

import { useMemo } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtNum, fmtPrice } from "@/lib/format";
import { impliedRevenueGrowth, runDcf, waccOf } from "@/lib/dcfModel";
import type { ValuationPayload } from "@/lib/valuationData";
import { Panel } from "../ui";

const pct = (v: number, lang: "es" | "en", d = 1) => `${fmtNum(v * 100, lang, d)}%`;

/**
 * Reverse DCF at the top of Valuation: the yearly revenue growth today's price assumes,
 * with the DCF's starting assumptions, next to what the company actually grew.
 */
export default function PriceImplies({ v, onAdjust }: { v: ValuationPayload; onAdjust: () => void }) {
  const { t, lang } = useI18n();
  const P = t.priceImplies;
  const { base, defaults, data } = v.maker;
  const result = useMemo(() => {
    if (!base || !defaults || !runDcf(base, defaults).ok) return null;
    return { implied: impliedRevenueGrowth(base, defaults), wacc: waccOf(base, defaults).wacc };
  }, [base, defaults]);
  if (!result || !base || !defaults) return null;
  const { implied, wacc } = result;
  const n = defaults.growth.length;
  const past = data?.revenueCagr5 ?? null;
  return (
    <Panel title={P.title} id="price-implies">
      {implied.g !== null ? (
        <div className="space-y-1.5 text-sm">
          <p className="text-[15px]">
            {fill(P.text, { price: fmtPrice(base.price, lang), n })}{" "}
            <strong className="num font-semibold">{fill(P.growth, { g: pct(implied.g, lang) })}</strong>
          </p>
          {past !== null && (
            <p className="text-muted">
              {fill(P.past, { g: pct(past, lang) })} {implied.g > past ? P.more : P.less}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm">{implied.bound === "above" ? P.above : implied.bound === "below" ? P.below : P.none}</p>
      )}
      <p className="mt-3 text-xs text-muted leading-relaxed">
        {fill(P.how, {
          wacc: pct(wacc, lang),
          tg: defaults.terminal === "gordon" ? pct(defaults.terminalGrowth, lang) : `${fmtNum(defaults.exitMultiple, lang, 1)}x EV/EBITDA`,
        })}{" "}
        <button type="button" onClick={onAdjust} className="link">
          {P.adjust}
        </button>
      </p>
    </Panel>
  );
}
