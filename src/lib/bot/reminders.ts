// Server-side reminder store for the Telegram bot.
// Stores scheduled reminders keyed by chat id + fires them via the Telegram
// Bot API at the due time. In-memory only (resets on restart); for production
// multi-instance, swap with Redis or a database.

import type { ScheduleType } from "@/lib/isuct/types";

export interface Reminder {
  chatId: string;
  type: ScheduleType;
  entityId: string;
  entityName: string;
  subject: string;
  lessonTime: string; // ISO when the lesson starts
  fireAt: number; // epoch ms when the reminder should fire (lessonTime - leadMin)
  leadMinutes: number;
}

const reminders = new Map<string, Reminder[]>(); // chatId → reminders

export function addReminder(r: Reminder): void {
  const list = reminders.get(r.chatId) || [];
  // Avoid duplicate reminders for the same lesson
  const exists = list.some(
    (x) => x.lessonTime === r.lessonTime && x.subject === r.subject,
  );
  if (!exists) {
    list.push(r);
    reminders.set(r.chatId, list);
  }
}

export function getReminders(chatId: string): Reminder[] {
  return reminders.get(chatId) || [];
}

export function removeReminder(
  chatId: string,
  lessonTime: string,
  subject: string,
): void {
  const list = reminders.get(chatId);
  if (!list) return;
  const next = list.filter(
    (x) => !(x.lessonTime === lessonTime && x.subject === subject),
  );
  if (next.length) reminders.set(chatId, next);
  else reminders.delete(chatId);
}

export function clearReminders(chatId: string): void {
  reminders.delete(chatId);
}

/** Returns all reminders that are due (fireAt <= now) and removes them. */
export function popDueReminders(now = Date.now()): Reminder[] {
  const due: Reminder[] = [];
  for (const [chatId, list] of reminders) {
    const remaining: Reminder[] = [];
    for (const r of list) {
      if (r.fireAt <= now) {
        due.push(r);
      } else {
        remaining.push(r);
      }
    }
    if (remaining.length) reminders.set(chatId, remaining);
    else reminders.delete(chatId);
  }
  return due;
}
