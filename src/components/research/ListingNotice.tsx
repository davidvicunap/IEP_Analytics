"use client";

// On a stock's research tab: when the SEC list says the ticker was renamed (FB → META), offer to
// move the notebook, alerts and trades in one tap; when it no longer trades, say what can be done.
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MoveResult } from "@/app/api/symbols/move/route";
import { fill, useI18n } from "@/lib/i18n";
import { toViewResult } from "@/lib/resource";
import { useSymbolInfo } from "@/lib/symbolsClient";
import { useWatchlist } from "@/lib/watchlist";
import { StatusMessage, buttonClass } from "../ui";

export default function ListingNotice({ symbol }: { symbol: string }) {
  const { t } = useI18n();
  const L = t.listing;
  const info = useSymbolInfo([symbol]);
  const router = useRouter();
  const { list, add, remove } = useWatchlist();
  const [status, setStatus] = useState<{ kind: "idle" } | { kind: "moving" } | { kind: "error"; text: string }>({ kind: "idle" });
  const listing = info.listing(symbol);
  if (!listing || (listing.status !== "renamed" && listing.status !== "delisted")) return null;
  if (listing.status === "delisted") {
    return (
      <div id="listing">
        <StatusMessage tone="warn">{fill(L.delisted, { s: symbol })}</StatusMessage>
      </div>
    );
  }
  const to = listing.to;
  const move = async () => {
    setStatus({ kind: "moving" });
    let res: Response;
    try {
      res = await fetch("/api/symbols/move", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: symbol, to }) });
    } catch {
      return setStatus({ kind: "error", text: L.failed });
    }
    const json = await res.json().catch(() => null);
    if (res.status === 409) return setStatus({ kind: "error", text: fill(L.conflict, { s: symbol, to }) });
    const r = toViewResult<MoveResult>(res.status, json);
    if (!r.ok) return setStatus({ kind: "error", text: r.error === "beta_expired" ? t.data.betaExpired : L.failed });
    if (list.includes(symbol)) {
      remove(symbol);
      add(to);
    }
    router.push(`/stock/${encodeURIComponent(to)}?tab=research`);
  };
  return (
    <div id="listing" className="space-y-2 rounded-2xl border border-line bg-panel p-4">
      <StatusMessage tone="warn">{fill(L.renamed, { s: symbol, to })}</StatusMessage>
      <button type="button" onClick={move} disabled={status.kind === "moving"} className={buttonClass("primary", true)}>
        {status.kind === "moving" ? L.moving : fill(L.move, { to })}
      </button>
      {status.kind === "error" && <StatusMessage tone="warn">{status.text}</StatusMessage>}
    </div>
  );
}
