import { DEFAULT_CHART, chartHeight, type ChartSettings } from "@/lib/chartSettings";

/**
 * Reserves the chart's exact space (controls, legend and canvas) while its code and data
 * load, so nothing below it moves when it appears.
 */
export default function ChartPlaceholder({ settings = DEFAULT_CHART }: { settings?: ChartSettings }) {
  const block = "rounded-md bg-panel-2 animate-pulse motion-reduce:animate-none";
  return (
    <div aria-hidden="true">
      <div className="flex flex-wrap gap-x-4 gap-y-3 mb-3">
        <div className={`${block} h-[62px] sm:h-[54px] w-52`} />
        <div className={`${block} h-[62px] sm:h-[54px] w-36`} />
      </div>
      <div className={`${block} hidden sm:block h-[60px] mb-3`} />
      <div className={`${block} h-5 mb-1.5 w-3/4`} />
      <div className={`${block} rounded-lg w-full`} style={{ height: chartHeight(settings.inds) }} />
    </div>
  );
}
