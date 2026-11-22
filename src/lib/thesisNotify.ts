// Live-thesis alerts on the phone: an alert store that remembers what fired during one check,
// and the step that sends it afterwards. Only new firings notify; an alert revived within its
// 24 h de-duplication window or cleared does not.
import { alertMessages } from "./push";
import { defaultChannels, deliver, type Channels } from "./notify";
import type { PushStore, Sender } from "./pushServer";
import type { Signal } from "./thesis";
import type { AlertStore } from "./thesisAlertStore";

/** owner → symbol → alerts that fired. */
export type Fired = Map<string, Map<string, Signal[]>>;

export function recordingFires(store: AlertStore): { alerts: AlertStore; fired: Fired } {
  const fired: Fired = new Map();
  const alerts: AlertStore = {
    ...store,
    async apply(owner, symbol, fire, clear, now, revive) {
      await store.apply(owner, symbol, fire, clear, now, revive);
      if (!fire.length) return;
      if (!fired.has(owner)) fired.set(owner, new Map());
      const mine = fired.get(owner)!;
      mine.set(symbol, [...(mine.get(symbol) ?? []), ...fire]);
    },
  };
  return { alerts, fired };
}

export interface NotifySummary {
  owners: number;
  sent: number;
  failed: number;
  gone: number;
}

/** Sends what fired to each owner's phones and Telegram chats. Never throws: a failed send is logged, not fatal. */
export async function notifyFired(fired: Fired, deps: { store?: PushStore | null; sender?: Sender; now?: Date; channels?: Channels } = {}): Promise<NotifySummary> {
  const summary: NotifySummary = { owners: 0, sent: 0, failed: 0, gone: 0 };
  if (fired.size === 0) return summary;
  const channels: Channels = deps.channels ?? (deps.store !== undefined ? { push: deps.store, sender: deps.sender } : { ...defaultChannels(), sender: deps.sender });
  if (!channels.push && !channels.telegram) return summary;
  for (const [owner, bySymbol] of fired) {
    const list = [...bySymbol].map(([symbol, alerts]) => ({ symbol, alerts }));
    try {
      const r = await deliver(owner, (t, lang) => alertMessages(list, t, lang), channels, deps.now);
      if (r.push.devices + r.telegram.devices) summary.owners++;
      summary.sent += r.push.sent + r.telegram.sent;
      summary.failed += r.push.failed + r.telegram.failed;
      summary.gone += r.push.gone + r.telegram.gone;
    } catch (e) {
      summary.failed++;
      console.error(JSON.stringify({ event: "push_notify_error", message: e instanceof Error ? e.message : String(e) }));
    }
  }
  return summary;
}
