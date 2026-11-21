import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron";
import { deliver } from "@/lib/notify";
import { uncheckedMessage } from "@/lib/push";
import { researchStore } from "@/lib/researchServer";
import { symbolInfoMap } from "@/lib/symbolsData";
import { alertStore } from "@/lib/thesisAlertStore";
import { checkHoldings, checkTheses, factsCache, marketDate } from "@/lib/thesesData";
import { notifyFired, recordingFires } from "@/lib/thesisNotify";
import type { SignalKind } from "@/lib/thesis";
import { tradeStore } from "@/lib/tradeStore";
import { book, positions } from "@/lib/trades";

export const maxDuration = 60;

/** The run after the close (vercel.json "23 21 * * 1-5"): it also reports what couldn't be checked today. */
const AFTER_CLOSE = "23 21 * * 1-5";
function isAfterClose(request: Request, now: Date): boolean {
  const schedule = request.headers.get("x-vercel-cron-schedule");
  return schedule ? schedule === AFTER_CLOSE : now.getUTCHours() >= 20;
}

/**
 * Weekdays, three times while the US market is open and once after the close: checks everyone's
 * live theses and holdings, so alerts are recorded (and sent to phones and Telegram) even when
 * nobody opens the app (scheduled in vercel.json). Stocks shared by several people load once per run.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const notes = researchStore();
  const store = alertStore();
  const trades = tradeStore();
  if (!notes || !store) return NextResponse.json({ error: "database_not_configured" }, { status: 503 });
  const now = new Date();
  const facts = factsCache(marketDate(now));
  const { alerts, fired } = recordingFires(store);
  const afterClose = isAfterClose(request, now);
  const summary = { owners: 0, checked: 0, holdings: 0, alerts: 0, skipped: 0, failed: 0, unchecked: 0 };
  const owners = [...new Set([...(await notes.owners()), ...((await trades?.owners()) ?? [])])];
  for (const owner of owners) {
    try {
      const list = await notes.list(owner);
      const mine = (await trades?.list(owner)) ?? [];
      const info = await symbolInfoMap([...list.map((n) => n.symbol), ...mine.map((t) => t.symbol)]);
      const r = await checkTheses(owner, list, alerts, facts, now, Infinity, { info, notes }); // every thesis, every run
      const held = positions(book(mine, [...info.values()].flatMap((i) => i.splits)).open).map((p) => p.symbol);
      const notChecked = await checkHoldings(owner, held, new Map(list.map((n) => [n.symbol, n])), alerts, facts, now);
      summary.owners++;
      summary.checked += r.items.length;
      summary.holdings += held.length;
      summary.alerts += r.items.reduce((n, i) => n + i.alerts.length, 0);
      summary.skipped += r.skipped;
      if (afterClose) {
        // Said plainly once a day: what we couldn't check, so silence isn't mistaken for "all fine".
        const byStock = new Map<string, SignalKind[]>();
        for (const i of r.items) if (i.unchecked.length) byStock.set(i.symbol, i.unchecked);
        for (const h of notChecked) byStock.set(h.symbol, [...(byStock.get(h.symbol) ?? []), ...h.unchecked]);
        if (byStock.size) {
          summary.unchecked += byStock.size;
          await deliver(owner, (t) => uncheckedMessage([...byStock].map(([symbol, kinds]) => ({ symbol, kinds })), t), undefined, now);
        }
      }
    } catch (e) {
      summary.failed++;
      console.error(JSON.stringify({ event: "cron_theses_owner_failed", message: e instanceof Error ? e.message : String(e) }));
    }
  }
  const pushed = await notifyFired(fired, { now });
  console.info(JSON.stringify({ event: "cron_theses", ...summary, afterClose, pushed }));
  return NextResponse.json({ ok: summary.failed === 0, ...summary, afterClose, pushed });
}
