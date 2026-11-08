"use client";

import { useEffect, useRef, useState } from "react";

/** The app's resolved theme, kept in sync with the theme toggle and the system setting. */
export function useResolvedTheme(): "dark" | "light" {
  const read = () => {
    if (typeof document === "undefined") return "dark" as const;
    const attr = document.documentElement.dataset.theme;
    if (attr === "light" || attr === "dark") return attr;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  };
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const update = () => setTheme(read());
    update();
    const mq = matchMedia("(prefers-color-scheme: dark)");
    window.addEventListener("iep-theme", update);
    mq.addEventListener("change", update);
    return () => {
      window.removeEventListener("iep-theme", update);
      mq.removeEventListener("change", update);
    };
  }, []);
  return theme;
}

/**
 * TradingView symbol for a US listing: exchange prefix where it's unambiguous, share classes
 * with a dot (BRK-B → BRK.B). Without a known exchange TradingView resolves the bare ticker.
 */
export function tvSymbol(symbol: string, exchange?: string): string {
  const s = symbol.toUpperCase().replace(/-/g, ".");
  const ex = (exchange ?? "").toUpperCase();
  if (ex.includes("NASDAQ")) return `NASDAQ:${s}`;
  if (ex === "AMEX" || ex.includes("ARCA") || ex.includes("AMERICAN")) return `AMEX:${s}`;
  if (ex.includes("NYSE")) return `NYSE:${s}`;
  return s;
}

/**
 * Embeds one of TradingView's free widgets (their script reads the JSON config placed inside
 * it). The attribution link below the widget is required by TradingView's terms.
 */
export default function TradingViewWidget({
  widget,
  config,
  height,
  title,
  attribution,
  attributionHref = "https://www.tradingview.com/",
}: {
  widget: "advanced-chart" | "timeline";
  config: Record<string, unknown>;
  height: number | string;
  title: string;
  attribution: string;
  attributionHref?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const key = JSON.stringify(config);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.replaceChildren();
    const inner = document.createElement("div");
    inner.className = "tradingview-widget-container__widget";
    inner.style.height = "100%";
    inner.style.width = "100%";
    const script = document.createElement("script");
    script.src = `https://s3.tradingview.com/external-embedding/embed-widget-${widget}.js`;
    script.type = "text/javascript";
    script.async = true;
    script.text = key;
    el.append(inner, script);
    // TradingView creates its iframe asynchronously: give it a title for screen readers.
    const observer = new MutationObserver(() => {
      el.querySelectorAll("iframe:not([title])").forEach((f) => f.setAttribute("title", title));
    });
    observer.observe(el, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      el.replaceChildren();
    };
  }, [widget, key, title]);

  return (
    <div>
      <div ref={ref} className="tradingview-widget-container w-full overflow-hidden rounded-lg" style={{ height }} aria-label={title} role="region" />
      <p className="mt-1 text-[11px] text-muted">
        <a href={attributionHref} rel="noopener nofollow" target="_blank" className="underline">
          {attribution}
        </a>
      </p>
    </div>
  );
}
