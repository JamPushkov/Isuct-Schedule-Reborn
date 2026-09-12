// Server-side pinned-entities store for the Telegram bot.
// Lets Telegram users save multiple groups/teachers/auditoriums and switch
// between them via a "📌 Избранное" button in the engine's schedule menu.
// In-memory only (resets on restart); for production multi-instance, swap
// with Redis or a database.

import type { ScheduleType } from "@/lib/isuct/types";

export interface PinnedEntity {
  type: ScheduleType;
  id: string;
  name: string;
}

const PINNED_MAX = 6;
const pinned = new Map<string, PinnedEntity[]>(); // chatId → entities

export function getPinned(chatId: string): PinnedEntity[] {
  return pinned.get(chatId) || [];
}

export function addPinned(chatId: string, e: PinnedEntity): PinnedEntity[] {
  const cur = pinned.get(chatId) || [];
  const filtered = cur.filter(
    (x) => !(x.type === e.type && x.id === e.id),
  );
  filtered.unshift(e);
  const next = filtered.slice(0, PINNED_MAX);
  pinned.set(chatId, next);
  return next;
}

export function removePinned(
  chatId: string,
  type: ScheduleType,
  id: string,
): PinnedEntity[] {
  const cur = pinned.get(chatId) || [];
  const next = cur.filter((x) => !(x.type === type && x.id === id));
  if (next.length) pinned.set(chatId, next);
  else pinned.delete(chatId);
  return next;
}

export function isPinned(
  chatId: string,
  type: ScheduleType,
  id: string,
): boolean {
  return (pinned.get(chatId) || []).some(
    (x) => x.type === type && x.id === id,
  );
}

export const PINNED_LIMIT = PINNED_MAX;
