// Server-side settings store (per chat).
// Stores reminder preferences. In-memory only; swap with Redis for production.

export type ReminderMode = "lesson" | "daily";

export interface ReminderSettings {
  enabled: boolean;
  mode: ReminderMode;
  /** For "lesson" mode: minutes before the lesson to fire. */
  leadMinutes: number;
  /** For "daily" mode: HH:MM when to send the daily morning summary. */
  dailyTime: string;
}

const DEFAULT_SETTINGS: ReminderSettings = {
  enabled: false,
  mode: "lesson",
  leadMinutes: 5,
  dailyTime: "07:00",
};

const settings = new Map<string, ReminderSettings>();

export function getSettings(chatId: string): ReminderSettings {
  return settings.get(chatId) || { ...DEFAULT_SETTINGS };
}

export function updateSettings(
  chatId: string,
  patch: Partial<ReminderSettings>,
): ReminderSettings {
  const cur = getSettings(chatId);
  const next = { ...cur, ...patch };
  settings.set(chatId, next);
  return next;
}

export function resetSettings(chatId: string): void {
  settings.delete(chatId);
}

/** Returns all chat IDs that have daily reminders enabled (for the cron). */
export function getDailyReminderChats(): Array<{
  chatId: string;
  dailyTime: string;
}> {
  const result: Array<{ chatId: string; dailyTime: string }> = [];
  for (const [chatId, s] of settings) {
    if (s.enabled && s.mode === "daily") {
      result.push({ chatId, dailyTime: s.dailyTime });
    }
  }
  return result;
}
