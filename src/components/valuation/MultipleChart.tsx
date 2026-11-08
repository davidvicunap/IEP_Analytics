"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ColorType, LineSeries, LineStyle, createChart } from "lightweight-charts";

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

/** 5-year line of one multiple with its median and ±1 standard deviation band. */
export default function MultipleChart({
  points,
  median,
  mean,
  sd,
  labels,
  format,
  summary,
}: {
  points: { date: string; value: number }[];
  median: number;
  mean: number;
  sd: number;
  labels: { median: string; plus: string; minus: string };
  format: (v: number) => string;
  summary: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const captionId = useId();
  const [themeV, setThemeV] = useState(0);
  useEffect(() => {
    const bump = () => setThemeV((x) => x + 1);
    window.addEventListener("iep-theme", bump);
    return () => window.removeEventListener("iep-theme", bump);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || points.length === 0) return;
    const c = { bg: cssVar("--panel"), text: cssVar("--muted"), grid: cssVar("--border"), accent: cssVar("--series-1"), info: cssVar("--info"), warn: cssVar("--warn") };
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: c.bg }, textColor: c.text, fontSize: 11, attributionLogo: true },
      grid: { vertLines: { color: c.grid + "55" }, horzLines: { color: c.grid + "55" } },
      rightPriceScale: { borderColor: c.grid },
      timeScale: { borderColor: c.grid, fixLeftEdge: true, fixRightEdge: true },
      localization: { priceFormatter: format },
      handleScroll: { vertTouchDrag: false },
    });
    const line = chart.addSeries(LineSeries, { color: c.accent, lineWidth: 2, priceLineVisible: false });
    line.setData(points.map((p) => ({ time: p.date, value: p.value })));
    line.createPriceLine({ price: median, color: c.info, lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: labels.median });
    if (sd > 0) {
      line.createPriceLine({ price: mean + sd, color: c.warn, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: labels.plus });
      line.createPriceLine({ price: mean - sd, color: c.warn, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: labels.minus });
    }
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [points, median, mean, sd, labels, format, themeV]);

  // A figure, not role="img": the chart holds a focusable attribution link.
  return (
    <figure aria-labelledby={captionId} className="m-0">
      <div ref={ref} className="h-[300px] w-full" />
      <figcaption id={captionId} className="sr-only">
        {summary}
      </figcaption>
    </figure>
  );
}
