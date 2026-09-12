import { NextResponse } from "next/server";
import { popDueReminders } from "@/lib/bot/reminders";
import { isValidToken, tgCall } from "@/lib/bot/telegram";
import { incRemindersFired } from "@/lib/bot/analytics";
import { getDailyReminderChats } from "@/lib/bot/reminder-settings";
import { getSchedule, getCurrentParity } from "@/lib/isuct/schedule-store";
import type { WeekDayIndex } from "@/lib/isuct/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_NAMES_FULL = ["", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

/**
 * Cron-callable endpoint that fires all due Telegram reminders.
 * Handles two types:
 * 1. Per-lesson reminders (stored in the reminders store) — fires a short
 *    "soon пара" message.
 * 2. Daily morning reminders — checks if the current time matches a chat's
 *    configured daily time, then sends the full day's schedule.
 *
 * Call this every minute via an external cron (or Vercel Cron):
 *   GET /api/telegram/check-reminders
 */
export async function GET() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !isValidToken(token)) {
    return NextResponse.json(
      { ok: false, error: "TELEGRAM_BOT_TOKEN not configured" },
      { status: 503 },
    );
  }

  let fired = 0;
  const errors: string[] = [];

  // 1. Fire due per-lesson reminders
  const due = popDueReminders();
  for (const r of due) {
    const res = await tgCall(token, "sendMessage", {
      chat_id: Number(r.chatId),
      text: `🔔 <b>Скоро пара!</b>\n\n📚 <b>${r.subject}</b>\n⏰ через ${r.leadMinutes} мин\n${r.entityName ? `🎓 ${r.entityName}` : ""}`,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    if (res?.ok) {
      fired++;
      incRemindersFired();
    }
  }

  // 2. Check daily morning reminders
  const now = new Date();
  const currentHHMM = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  const dailyChats = getDailyReminderChats();
  for (const dc of dailyChats) {
    if (dc.dailyTime !== currentHHMM) continue;
    try {
      // Find the user's last-selected entity from the pinned store or
      // popular stats. In a production system, we'd store the entity per chat.
      // For now, use the most-recently-pinned entity.
      const { getPinned } = await import("@/lib/bot/pinned-store");
      const pinned = getPinned(dc.chatId);
      if (pinned.length === 0) continue;
      const entity = pinned[0];

      const schedule = await getSchedule(entity.type, entity.id, entity.name);
      const parity = getCurrentParity();
      const week = schedule.weeks[parity];
      const dayIdx = (now.getDay() === 0 ? 7 : now.getDay()) as WeekDayIndex;
      const daySched = week.days.find((d) => d.day === dayIdx);

      let dayText: string;
      if (!daySched || daySched.lessons.length === 0) {
        dayText = "🎉 Сегодня пар нет — выходной!";
      } else {
        const sorted = [...daySched.lessons].sort((a, b) =>
          a.time.localeCompare(b.time),
        );
        dayText = sorted
          .map((l) => `⏰ ${l.time} — ${l.subject}${l.place ? ` (${l.place})` : ""}`)
          .join("\n");
      }

      const res = await tgCall(token, "sendMessage", {
        chat_id: Number(dc.chatId),
        text: `☀️ <b>Доброе утро!</b>\n\n📅 ${DAY_NAMES_FULL[dayIdx]}, ${parity} неделя\n🎓 ${entity.name}\n\n${dayText}`,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
      if (res?.ok) {
        fired++;
        incRemindersFired();
      }
    } catch (e) {
      errors.push(`daily:${dc.chatId}: ${e}`);
    }
  }

  return NextResponse.json({
    ok: true,
    due: due.length,
    fired,
    errors: errors.length ? errors : undefined,
  });
}
