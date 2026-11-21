// Where alerts go: every phone/browser with push turned on and every linked Telegram chat of the
// beta label, each in its own language. A channel that isn't set up is skipped; failures are
// counted and logged, never thrown into the check that raised the alert.
import type { Lang } from "./format";
import type { CoreDict } from "./i18n/es";
import type { PushMessage } from "./push";
import { pushStore, sendToOwner, type PushStore, type SendResult, type Sender } from "./pushServer";
import { sendTelegram, telegramConfig, telegramStore, type TelegramApi, type TelegramConfig, type TelegramStore } from "./telegramServer";

export interface Channels {
  push?: PushStore | null;
  sender?: Sender;
  telegram?: { store: TelegramStore; config: TelegramConfig; api?: TelegramApi } | null;
}

export function defaultChannels(): Channels {
  const config = telegramConfig();
  const store = config ? telegramStore() : null;
  return { push: pushStore(), telegram: config && store ? { store, config } : null };
}

const EMPTY: SendResult = { devices: 0, sent: 0, failed: 0, gone: 0 };

export async function deliver(owner: string, build: (t: CoreDict, lang: Lang) => PushMessage[], channels: Channels = defaultChannels(), now = new Date()): Promise<{ push: SendResult; telegram: SendResult }> {
  const [push, telegram] = await Promise.all([
    channels.push ? sendToOwner(owner, build, { store: channels.push, sender: channels.sender, now }).catch((e) => fail("push", e)) : EMPTY,
    channels.telegram ? sendTelegram(owner, build, channels.telegram).catch((e) => fail("telegram", e)) : EMPTY,
  ]);
  return { push, telegram };
}

function fail(channel: string, e: unknown): SendResult {
  console.error(JSON.stringify({ event: "notify_error", channel, message: e instanceof Error ? e.message : String(e) }));
  return { devices: 0, sent: 0, failed: 1, gone: 0 };
}
