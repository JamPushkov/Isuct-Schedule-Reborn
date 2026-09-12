// In-memory session store keyed by chat id.
// Used by the web demo and (optionally) the Telegram polling service.
// For multi-instance deployments swap with Redis — same interface.

import type { BotSession } from "./engine";
import { newSession } from "./engine";
import { incSessions } from "./analytics";

const TTL_MS = 60 * 60 * 1000; // 1 hour idle
const store = new Map<string, { session: BotSession; expires: number }>();

export function getSession(chatId: string): BotSession {
  const e = store.get(chatId);
  if (!e || Date.now() > e.expires) {
    // New session (or expired) — count it for analytics.
    incSessions();
    const s = newSession();
    store.set(chatId, { session: s, expires: Date.now() + TTL_MS });
    return s;
  }
  return e.session;
}

export function saveSession(chatId: string, session: BotSession): void {
  store.set(chatId, { session, expires: Date.now() + TTL_MS });
  if (store.size > 2000) {
    const firstKey = store.keys().next().value;
    if (firstKey) store.delete(firstKey);
  }
}

export function resetSession(chatId: string): BotSession {
  const s = newSession();
  store.set(chatId, { session: s, expires: Date.now() + TTL_MS });
  return s;
}
