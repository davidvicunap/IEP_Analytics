// Where alerts go: every phone/browser with push turned on for the beta label, each in its own
// language. Without push set up nothing is sent; failures are counted and logged, never thrown
// into the check that raised the alert.
import { recordEvent } from "./eventStore";
import type { Lang } from "./format";
import type { CoreDict } from "./i18n/es";
import type { PushMessage } from "./push";
import { pushStore, sendToOwner, type PushStore, type SendResult, type Sender } from "./pushServer";

export interface Channels {
  push?: PushStore | null;
  sender?: Sender;
}

export function defaultChannels(): Channels {
  return { push: pushStore() };
}

const EMPTY: SendResult = { devices: 0, sent: 0, failed: 0, gone: 0 };

export async function deliver(owner: string, build: (t: CoreDict, lang: Lang) => PushMessage[], channels: Channels = defaultChannels(), now = new Date()): Promise<{ push: SendResult }> {
  const push = channels.push ? await sendToOwner(owner, build, { store: channels.push, sender: channels.sender, now }).catch((e: unknown) => fail("push", e)) : EMPTY;
  if (push.sent > 0) await recordEvent(owner, "alert_sent", { channel: "push", n: push.sent }, now);
  return { push };
}

function fail(channel: string, e: unknown): SendResult {
  console.error(JSON.stringify({ event: "notify_error", channel, message: e instanceof Error ? e.message : String(e) }));
  return { devices: 0, sent: 0, failed: 1, gone: 0 };
}
