"use client";

import { fill, useI18n } from "@/lib/i18n";
import { CHART_STUDIES, MAX_STUDIES, toggleStudy } from "@/lib/chartStudies";
import { studiesStore, useChartStudies } from "@/lib/chartStudiesClient";
import { ToggleChip } from "./ui";

/** The indicators every TradingView chart opens with (here and in your canvases), saved to your account. */
export default function ChartStudiesPicker() {
  const { t } = useI18n();
  const C = t.chart.studies;
  const list = useChartStudies();
  const full = list.length >= MAX_STUDIES;
  return (
    <section aria-labelledby="chart-studies" className="mt-3">
      <h3 id="chart-studies" className="text-[13px] font-medium">{C.title}</h3>
      <div role="group" aria-labelledby="chart-studies" className="mt-2 flex flex-wrap gap-1.5">
        {CHART_STUDIES.map((s) => (
          <ToggleChip key={s} on={list.includes(s)} onClick={() => studiesStore.write(toggleStudy(list, s))}>
            {C.names[s]}
          </ToggleChip>
        ))}
      </div>
      <p className="mt-2 max-w-[68ch] text-xs leading-relaxed text-muted">
        {full ? fill(C.full, { n: MAX_STUDIES }) : C.note}
      </p>
    </section>
  );
}
