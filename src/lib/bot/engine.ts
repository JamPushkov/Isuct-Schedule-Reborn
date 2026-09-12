// Bot conversation engine.
// Framework-agnostic: given a user input + session, returns the reply text +
// inline keyboard. Used by BOTH the web demo (/api/bot/chat) and the real
// Telegram webhook (/api/telegram/webhook) so behaviour is identical.

import type {
  DaySchedule,
  FullSchedule,
  Lesson,
  ScheduleType,
  SearchEntry,
  WeekDayIndex,
  WeekParity,
} from "@/lib/isuct/types";
import {
  DAY_NAMES_FULL,
  DAY_NAMES_SHORT,
  LESSON_TYPE_LABELS,
} from "@/lib/isuct/types";
import { computeCurrentParity } from "@/lib/isuct/scraper";
import {
  getCurrentParity,
  getPopular,
  getSchedule,
  searchSchedule,
  validateSearchQuery,
  clearScheduleCache,
} from "@/lib/isuct/schedule-store";
import { addReminder } from "@/lib/bot/reminders";
import {
  getPinned,
  addPinned,
  removePinned,
  isPinned,
  PINNED_LIMIT,
} from "@/lib/bot/pinned-store";
import { incRemindersSet, incPins, getAnalytics } from "@/lib/bot/analytics";
import {
  getSettings,
  updateSettings,
  type ReminderSettings,
} from "@/lib/bot/reminder-settings";

export type BotState =
  | "menu_type"
  | "enter_query"
  | "search_results"
  | "schedule_menu"
  | "week_days"
  | "enter_custom_lead"
  | "enter_custom_time";

export interface SelectedEntity {
  type: ScheduleType;
  id: string;
  name: string;
}

export interface BotSession {
  state: BotState;
  type?: ScheduleType;
  query?: string;
  results?: SearchEntry[];
  selected?: SelectedEntity;
  weekViewParity?: WeekParity;
  schedule?: FullSchedule;
  /** Internal: the chat id this session belongs to (set by the API route so
   *  the engine can store per-chat server-side reminders). Not part of the
   *  public session API. */
  __chatId?: string;
  /** Reminder settings stored in the session for persistence across calls. */
  reminderSettings?: ReminderSettings;
  /** Admin flag — set by the webhook based on the user's Telegram username. */
  __isAdmin?: boolean;
  /** Broadcast message (set by admin, read by check-reminders). */
  __broadcast?: string;
}

export interface InlineButton {
  text: string;
  callback_data: string;
}

export interface BotReply {
  /** HTML-formatted reply (Telegram HTML mode). */
  text: string;
  keyboard: InlineButton[][];
  session: BotSession;
  /** Whether the previous bot message should be edited instead of sending new. */
  edit?: boolean;
  /** When set, the web demo should request Notification permission and
   *  schedule a browser notification for the next lesson. */
  reminder?: {
    /** ISO time string of the lesson start, or null if no upcoming lesson. */
    lessonTime: string | null;
    /** Lesson subject for the notification body. */
    subject: string | null;
    /** Minutes before the lesson to fire the reminder. */
    leadMinutes: number;
    /** Friendly message describing when the reminder will fire. */
    message: string;
  };
  /** Whether this message contains a schedule. */
  isSchedule?: boolean;
  /** Telegram reply keyboard (regular keyboard, not inline).
   *  Used to show a "▶ Начать" button on first launch. */
  replyKeyboard?: string[][];
  /** Whether to remove the reply keyboard (hide the button). */
  removeReplyKeyboard?: boolean;
}

export type BotInput =
  | { kind: "start" }
  | { kind: "text"; text: string }
  | { kind: "callback"; data: string }
  | { kind: "resume"; resumeType: ScheduleType; resumeId: string; resumeName: string };

// ---------- helpers ----------

export function esc(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function b(s: string): string {
  return `<b>${esc(s)}</b>`;
}

const TYPE_LABEL: Record<ScheduleType, string> = {
  group: "студенту",
  teacher: "преподавателю",
  auditorium: "аудитории",
};

const TYPE_NOUN: Record<ScheduleType, string> = {
  group: "группа",
  teacher: "преподаватель",
  auditorium: "аудитория",
};

const TYPE_PICK_LABEL: Record<ScheduleType, string> = {
  group: "🎓 Студент",
  teacher: "👨‍🏫 Преподаватель",
  auditorium: "🏫 Аудитория",
};

const TYPE_PLACEHOLDER: Record<ScheduleType, string> = {
  group: "например: 2/25",
  teacher: "например: Смирнов",
  auditorium: "например: Г203",
};

const TYPE_PROMPT: Record<ScheduleType, string> = {
  group: "Введите номер группы",
  teacher: "Введите фамилию и инициалы преподавателя",
  auditorium: "Введите номер аудитории",
};

function jsDayToWeekDay(jsDay: number): WeekDayIndex {
  // JS: 0=Sun..6=Sat → 1=Mon..7=Sun
  return (jsDay === 0 ? 7 : jsDay) as WeekDayIndex;
}

function parityForDate(d: Date): WeekParity {
  return computeCurrentParity("2025-09-02", "II", d);
}

export function todayWeekDay(): WeekDayIndex {
  return jsDayToWeekDay(new Date().getDay());
}

function tomorrow(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d;
}

const RU_MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

function fmtDate(d: Date): string {
  return `${d.getDate()} ${RU_MONTHS[d.getMonth()]}`;
}

const TYPE_EMOJI: Record<string, string> = {
  лек: "📖",
  прак: "✏️",
  лаб: "🧪",
  зач: "📋",
  экз: "📝",
  кр: "📄",
};

const TYPE_EMOJI_BY_TYPE: Record<ScheduleType, string> = {
  group: "🎓",
  teacher: "👨‍🏫",
  auditorium: "🏫",
};

// ---------- rendering ----------

function renderLesson(l: Lesson): string {
  const typeLabel = l.type ? LESSON_TYPE_LABELS[l.type] || l.type : "Пара";
  const emoji = l.type ? TYPE_EMOJI[l.type] || "📘" : "📘";
  const parts: string[] = [];
  parts.push(`<b>${esc(l.time)}</b>  ${emoji} ${esc(typeLabel)}`);
  parts.push(`<b>${esc(l.subject)}</b>`);
  const meta: string[] = [];
  if (l.teacher) meta.push(`👤 ${esc(l.teacher)}`);
  if (l.group) meta.push(`👥 ${esc(l.group)}`);
  if (l.place) meta.push(`📍 ${esc(l.place)}`);
  if (l.subgroup) meta.push(`#${esc(l.subgroup)}`);
  if (meta.length) parts.push(meta.join("   "));
  if (l.weeks) parts.push(`<i>${esc(l.weeks)}</i>`);
  if (l.note) parts.push(`<i>ℹ️ ${esc(l.note)}</i>`);
  return parts.join("\n");
}

function renderDay(
  schedule: FullSchedule,
  parity: WeekParity,
  day: WeekDayIndex,
  titleExtra?: string,
  highlightNow?: boolean,
): string {
  const week = schedule.weeks[parity];
  const daySched: DaySchedule | undefined = week.days.find((d) => d.day === day);
  const header =
    `${titleExtra ? titleExtra + "\n" : ""}` +
    `${b("📅 " + DAY_NAMES_FULL[day])}, ` +
    `${b(parity + " неделя")}`;
  if (!daySched || !daySched.lessons.length) {
    return `${header}\n\n🎉 ${esc("Занятий нет — выходной!")}`;
  }
  const sorted = [...daySched.lessons].sort((a, b) =>
    a.time.localeCompare(b.time),
  );

  // When highlighting (today view), find the current or next lesson to mark
  let highlightIndex = -1;
  if (highlightNow) {
    const nm = nowMin();
    // First, check if a lesson is currently in progress
    const currentIdx = sorted.findIndex((l) => {
      const r = parseTimeRange(l.time);
      return r && nm >= r[0] && nm <= r[1];
    });
    if (currentIdx >= 0) {
      highlightIndex = currentIdx;
    } else {
      // Otherwise, find the next upcoming lesson
      const nextIdx = sorted.findIndex((l) => {
        const r = parseTimeRange(l.time);
        return r && r[0] > nm;
      });
      if (nextIdx >= 0) highlightIndex = nextIdx;
    }
  }

  const body = sorted
    .map((l, i) => {
      if (i === highlightIndex) {
        const r = parseTimeRange(l.time);
        const nm = nowMin();
        let marker = "▶";
        if (r && nm >= r[0] && nm <= r[1]) {
          // currently in progress
          const left = r[1] - nm;
          const leftStr =
            left >= 60
              ? `${Math.floor(left / 60)} ч ${left % 60} мин`
              : `${left} мин`;
          return `🟢 ${b("ИДЁТ СЕЙЧАС")} (осталось ${esc(leftStr)})\n${renderLesson(l)}`;
        } else if (r) {
          const until = r[0] - nm;
          const untilStr =
            until >= 60
              ? `${Math.floor(until / 60)} ч ${until % 60} мин`
              : `${until} мин`;
          return `⏭️ ${b("СЛЕДУЮЩАЯ")} через ${esc(untilStr)}\n${renderLesson(l)}`;
        }
      }
      return renderLesson(l);
    })
    .join("\n\n");
  return `${header}\n\n${body}`;
}

/** Parse "HH:MM-HH:MM" into [startMin, endMin] since midnight, or null. */
function parseTimeRange(time: string): [number, number] | null {
  const m = time.match(/(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return [
    Number(m[1]) * 60 + Number(m[2]),
    Number(m[3]) * 60 + Number(m[4]),
  ];
}

function nowMin(d = new Date()): number {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Render the "right now" view: the lesson currently in progress, or the next
 * lesson today, or a note that the day is over (peek at tomorrow).
 */
function renderNow(schedule: FullSchedule): string {
  const now = new Date();
  const day = jsDayToWeekDay(now.getDay());
  const parity = parityForDate(now);
  const week = schedule.weeks[parity];
  const daySched = week.days.find((d) => d.day === day);
  const nm = nowMin(now);

  const header =
    `${renderScheduleHeader(schedule)}\n\n` +
    `${b("⏱ Сейчас")} (${esc(fmtDate(now))}, ${esc(DAY_NAMES_FULL[day])})`;

  if (day === 7 || !daySched || !daySched.lessons.length) {
    // Sunday or no lessons today → peek tomorrow
    const tmr = tomorrow();
    const tday = jsDayToWeekDay(tmr.getDay());
    const tpar = parityForDate(tmr);
    const tweek = schedule.weeks[tpar];
    const tSched = tweek.days.find((d) => d.day === tday);
    if (tSched && tSched.lessons.length) {
      const first = [...tSched.lessons].sort((a, b) =>
        a.time.localeCompare(b.time),
      )[0];
      return (
        `${header}\n\n` +
        `🎉 Сегодня пар больше нет.\n\n` +
        `${b("👉 Завтра первая пара:")}\n${renderLesson(first)}`
      );
    }
    return `${header}\n\n🎉 Сегодня и завтра пар нет. Отдыхай!`;
  }

  const sorted = [...daySched.lessons].sort((a, b) =>
    a.time.localeCompare(b.time),
  );

  // Find lesson in progress
  const current = sorted.find((l) => {
    const r = parseTimeRange(l.time);
    return r && nm >= r[0] && nm <= r[1];
  });
  if (current) {
    const r = parseTimeRange(current.time)!;
    const left = r[1] - nm;
    const leftStr =
      left >= 60
        ? `${Math.floor(left / 60)} ч ${left % 60} мин`
        : `${left} мин`;
    return (
      `${header}\n\n` +
      `🟢 ${b("Идёт пара")} (осталось ${esc(leftStr)}):\n\n${renderLesson(current)}`
    );
  }

  // Find next lesson today
  const next = sorted.find((l) => {
    const r = parseTimeRange(l.time);
    return r && r[0] > nm;
  });
  if (next) {
    const r = parseTimeRange(next.time)!;
    const until = r[0] - nm;
    const untilStr =
      until >= 60
        ? `${Math.floor(until / 60)} ч ${until % 60} мин`
        : `${until} мин`;
    return (
      `${header}\n\n` +
      `⏭️ ${b("Следующая пара")} через ${esc(untilStr)}:\n\n${renderLesson(next)}`
    );
  }

  // All lessons done today → peek tomorrow
  const tmr = tomorrow();
  const tday = jsDayToWeekDay(tmr.getDay());
  const tpar = parityForDate(tmr);
  const tweek = schedule.weeks[tpar];
  const tSched = tweek.days.find((d) => d.day === tday);
  if (tSched && tSched.lessons.length) {
    const first = [...tSched.lessons].sort((a, b) =>
      a.time.localeCompare(b.time),
    )[0];
    return (
      `${header}\n\n` +
      `🎉 Сегодня пары закончились.\n\n` +
      `${b("👉 Завтра первая пара:")}\n${renderLesson(first)}`
    );
  }
  return `${header}\n\n🎉 Сегодня пары закончились. Завтра тоже отдых!`;
}

/** Compact full-week view: all 6 days with lesson counts + subjects. */
function renderFullWeek(
  schedule: FullSchedule,
  parity: WeekParity,
): string {
  const week = schedule.weeks[parity];
  const lines: string[] = [];
  lines.push(renderScheduleHeader(schedule));
  lines.push("");
  lines.push(`${b("📋 Расписание на " + parity + " неделю")}:`);
  lines.push("");

  for (let d = 1; d <= 6; d++) {
    const day = d as WeekDayIndex;
    const daySched = week.days.find((x) => x.day === day);
    const name = DAY_NAMES_FULL[day];
    if (!daySched || !daySched.lessons.length) {
      lines.push(`${b(DAY_NAMES_SHORT[day])} · ${esc(name)}`);
      lines.push(`   🌿 выходной`);
      continue;
    }
    const sorted = [...daySched.lessons].sort((a, b) =>
      a.time.localeCompare(b.time),
    );
    lines.push(`${b(DAY_NAMES_SHORT[day])} · ${esc(name)} (${sorted.length} пар)`);
    for (const l of sorted) {
      const emoji = l.type ? TYPE_EMOJI[l.type] || "📘" : "📘";
      const start = l.time.split(/[-–—]/)[0].trim();
      lines.push(`   ${esc(start)} ${emoji} ${esc(l.subject)}`);
    }
  }
  return lines.join("\n");
}

function renderScheduleHeader(schedule: FullSchedule): string {
  const cur = schedule.currentParity;
  const icon =
    schedule.type === "group" ? "🎓" : schedule.type === "teacher" ? "👨‍🏫" : "🏫";
  const noun = TYPE_NOUN[schedule.type];
  return (
    `${icon} ${b(TYPE_LABEL[schedule.type].charAt(0).toUpperCase() + TYPE_LABEL[schedule.type].slice(1))}: ${esc(schedule.queryName)}\n` +
    `${b("Текущая неделя")}: ${cur} неделя` +
    (schedule.source === "sample" ? `\n⚠️ ${esc("Демо-данные (сайт недоступен)")}` : "")
  );
}

// ---------- keyboards ----------

const K_TYPE_MENU: InlineButton[][] = [
  [{ text: "🎓 Студент", callback_data: "t:group" }],
  [{ text: "👨‍🏫 Преподаватель", callback_data: "t:teacher" }],
  [{ text: "🏫 Аудитория", callback_data: "t:auditorium" }],
];

function kBackToType(): InlineButton[][] {
  return [[{ text: "↩ К выбору", callback_data: "back:type" }]];
}

function kScheduleMenu(chatId?: string): InlineButton[][] {
  const rows: InlineButton[][] = [
    [
      { text: "📌 Сегодня", callback_data: "act:today" },
      { text: "👉 Завтра", callback_data: "act:tomorrow" },
      { text: "⏱ Сейчас", callback_data: "act:now" },
    ],
    [
      { text: "🗓 Неделя", callback_data: "act:week" },
      { text: "📋 Вся неделя", callback_data: "act:fullweek" },
    ],
    // [TEMPORARILY DISABLED — Избранное feature commented out]
    // [
    //   { text: "⚙️ Настройки", callback_data: "settings:menu" },
    //   { text: "📌 В избранное", callback_data: "pin:add" },
    // ],
    [
      { text: "⚙️ Настройки", callback_data: "settings:menu" },
      { text: "🔄 Сменить", callback_data: "act:change" },
    ],
  ];
  // [TEMPORARILY DISABLED — pinned entities button]
  // if (chatId && getPinned(chatId).length > 0) {
  //   rows.push([{ text: `📌 Избранное (${getPinned(chatId).length})`, callback_data: "pin:list" }]);
  // }
  return rows;
}

function kWeekDays(parity: WeekParity): InlineButton[][] {
  const days: WeekDayIndex[] = [1, 2, 3, 4, 5, 6];
  const rows: InlineButton[][] = [];
  // 2x3 grid
  for (let r = 0; r < days.length; r += 3) {
    rows.push(
      days.slice(r, r + 3).map((d) => ({
        text: DAY_NAMES_SHORT[d],
        callback_data: `day:${d}`,
      })),
    );
  }
  rows.push([
    {
      text: parity === "I" ? "● I неделя" : "I неделя",
      callback_data: "wk:I",
    },
    {
      text: parity === "II" ? "● II неделя" : "II неделя",
      callback_data: "wk:II",
    },
  ]);
  rows.push([{ text: "↩ К расписанию", callback_data: "back:menu" }]);
  return rows;
}

/**
 * Build the top-level type-menu reply, injecting popular groups as quick-pick
 * callback buttons when enough popularity data exists. Used by both /start
 * and the `/start` text command so the Telegram bot (not just the web demo)
 * can offer popular suggestions.
 */
function buildTypeMenuReply(session: BotSession, greeting: string): BotReply {
  const popular = getPopular(4).filter((p) => p.type === "group");
  const keyboard: InlineButton[][] = [...K_TYPE_MENU];

  // [TEMPORARILY DISABLED — pinned entities quick-pick on /start]
  // const chatId = session.__chatId || "";
  // const pinnedList = getPinned(chatId).slice(0, 3);
  // if (pinnedList.length > 0) {
  //   keyboard.push(
  //     pinnedList.map((p) => ({
  //       text: `📌 ${TYPE_EMOJI_BY_TYPE[p.type]} ${p.name}`,
  //       callback_data: `pick:${p.type}:${p.id}:${encodeURIComponent(p.name)}`,
  //     })),
  //   );
  // }

  if (popular.length >= 2) {
    keyboard.push(
      popular.map((p) => ({
        text: `${TYPE_EMOJI_BY_TYPE[p.type] || "🔥"} ${p.name}`,
        callback_data: `pick:${p.type}:${p.id}:${encodeURIComponent(p.name)}`,
      })),
    );
  }

  let extraLine = "";
  // [TEMPORARILY DISABLED]
  // if (pinnedList.length > 0) {
  //   extraLine += `\n\n📌 ${b("Избранное")} — твои сохранённые группы.`;
  // }
  if (popular.length >= 2) {
    extraLine += `\n🔥 ${b("Популярные группы")}: нажми, чтобы быстро открыть.`;
  }
  return {
    text: `${b(greeting)}\n\nВыбери, для кого нужно расписание:${extraLine}`,
    keyboard,
    session,
  };
}

// ---------- main processor ----------

export async function processInput(
  input: BotInput,
  prev: BotSession,
): Promise<BotReply> {
  const session: BotSession = { ...prev };

  if (input.kind === "start") {
    // Auto-resume: if the user already selected a group/teacher/auditorium
    // in a previous interaction (server-side session, 1h TTL), skip the
    // type-selection menu and jump straight to the schedule menu. The user
    // can press "🔄 Сменить" to pick something else.
    if (session.selected) {
      session.type = session.selected.type;
      session.state = "enter_query";
      session.results = undefined;
      session.schedule = undefined;
      return selectEntity(
        { id: session.selected.id, name: session.selected.name },
        session,
      );
    }
    session.state = "menu_type";
    const reply = buildTypeMenuReply(session, "Привет! Я ISUCT Schedule Reborn 👋");
    // Show "▶ Начать" button on first launch (removes after pressing)
    reply.replyKeyboard = [["▶ Начать"]];
    return reply;
  }

  if (input.kind === "resume") {
    // Quick-resume: directly select a previously-saved entity (used by the
    // web demo's localStorage "Продолжить с ..." button).
    session.type = input.resumeType;
    session.state = "enter_query";
    session.results = undefined;
    session.selected = undefined;
    session.schedule = undefined;
    return selectEntity(
      { id: input.resumeId, name: input.resumeName },
      session,
    );
  }

  if (input.kind === "callback") {
    return handleCallback(input.data, session);
  }

  // text input
  const text = input.text.trim();
  if (!text) return noop(session);

  // "▶ Начать" button = same as /start
  if (text === "▶ Начать" || /^\/start/i.test(text)) {
    // Check for admin commands first
    if (text.includes("admin") || text.includes("/admin")) {
      return handleAdmin(session, text);
    }
    if (session.selected) {
      session.type = session.selected.type;
      session.state = "enter_query";
      session.results = undefined;
      session.schedule = undefined;
      return selectEntity(
        { id: session.selected.id, name: session.selected.name },
        session,
      );
    }
    session.state = "menu_type";
    const reply = buildTypeMenuReply(session, "Привет! Я ISUCT Schedule Reborn 👋");
    reply.removeReplyKeyboard = true;
    return reply;
  }

  // Admin commands (only for @jamqwr)
  if (/^\/admin/i.test(text)) {
    return handleAdmin(session, text);
  }

  if (/^\/help/i.test(text)) {
    return {
      text:
        `${b("Помощь")}\n\n` +
        `Я показываю расписание занятий ИГХТУ.\n` +
        `• Выбери «Студент» или «Преподаватель»\n` +
        `• Введи номер группы (например 2/25) или ФИО преподавателя\n` +
        `• Используй кнопки «Сегодня», «Завтра», «Неделя»\n\n` +
        `Команды: /start — в начало, /help — помощь`,
      keyboard: session.state === "schedule_menu" ? kScheduleMenu(session.__chatId) : K_TYPE_MENU,
      session,
    };
  }

  // entering query for the chosen type
  if (session.state === "enter_query" && session.type) {
    return runSearch(session.type, text, session);
  }

  // ── Custom reminder time input ──────────────────────────────
  // When the user clicked "✏️ Своё время" in the settings menu, the engine
  // entered one of these states and waits for text input.
  if (session.state === "enter_custom_lead") {
    const chatId = session.__chatId || "";
    const schedule = await ensureSchedule(session);
    const settings = session.reminderSettings || {
      enabled: false,
      mode: "lesson" as const,
      leadMinutes: 5,
      dailyTime: "07:00",
    };
    const num = parseInt(text, 10);
    if (Number.isNaN(num) || num < 1 || num > 120) {
      return {
        text:
          (schedule ? `${renderScheduleHeader(schedule)}\n\n` : "") +
          `⚠️ Введи число от 1 до 120.`,
        keyboard: [[{ text: "↩ Отмена", callback_data: "settings:menu" }]],
        session,
        edit: false,
      };
    }
    const newSettings = {
      ...settings,
      leadMinutes: num,
    };
    session.reminderSettings = newSettings;
    updateSettings(chatId, newSettings);
    session.state = "schedule_menu";
    if (newSettings.enabled && schedule) {
      scheduleLessonReminder(chatId, schedule, newSettings);
    }
    return handleSettingsMenu(session, schedule, newSettings);
  }

  if (session.state === "enter_custom_time") {
    const chatId = session.__chatId || "";
    const schedule = await ensureSchedule(session);
    const settings = session.reminderSettings || {
      enabled: false,
      mode: "daily" as const,
      leadMinutes: 5,
      dailyTime: "07:00",
    };
    const m = text.match(/^(\d{1,2})[:.](\d{2})$/);
    if (!m) {
      return {
        text:
          (schedule ? `${renderScheduleHeader(schedule)}\n\n` : "") +
          `⚠️ Введи время в формате ЧЧ:ММ (например, 06:30).`,
        keyboard: [[{ text: "↩ Отмена", callback_data: "settings:menu" }]],
        session,
        edit: false,
      };
    }
    const hhNum = parseInt(m[1], 10);
    const mmNum = parseInt(m[2], 10);
    if (hhNum > 23 || mmNum > 59) {
      return {
        text:
          (schedule ? `${renderScheduleHeader(schedule)}\n\n` : "") +
          `⚠️ Неверное время. Часы 0–23, минуты 0–59.`,
        keyboard: [[{ text: "↩ Отмена", callback_data: "settings:menu" }]],
        session,
        edit: false,
      };
    }
    const hh = m[1].padStart(2, "0");
    const mm = m[2];
    const newSettings = { ...settings, dailyTime: `${hh}:${mm}` };
    session.reminderSettings = newSettings;
    updateSettings(chatId, newSettings);
    session.state = "schedule_menu";
    return handleSettingsMenu(session, schedule, newSettings);
  }

  // any other text in other states → hint
  return {
    text: `Воспользуйся кнопками ниже или отправь /start, чтобы начать заново.`,
    keyboard: session.state === "schedule_menu" ? kScheduleMenu(session.__chatId) : K_TYPE_MENU,
    session,
  };
}

function noop(session: BotSession): BotReply {
  return {
    text: "🙂",
    keyboard: K_TYPE_MENU,
    session,
  };
}

async function runSearch(
  type: ScheduleType,
  query: string,
  session: BotSession,
): Promise<BotReply> {
  const results = await searchSchedule(type, query);
  session.query = query;
  session.results = results;
  if (!results.length) {
    session.state = "enter_query";
    return {
      text:
        `🔍 По запросу «${esc(query)}» ничего не найдено.\n` +
        `Попробуй уточнить (${esc(TYPE_PLACEHOLDER[type])}).`,
      keyboard: kBackToType(),
      session,
    };
  }
  if (results.length === 1) {
    return selectEntity(results[0], session);
  }
  session.state = "search_results";
  const rows: InlineButton[][] = results.slice(0, 8).map((r, i) => [
    { text: r.name, callback_data: `sel:${i}` },
  ]);
  rows.push([{ text: "↩ К выбору", callback_data: "back:type" }]);
  return {
    text: `🔍 Найдено по запросу «${esc(query)}».\nВыбери из списка:`,
    keyboard: rows,
    session,
  };
}

async function selectEntity(
  entry: SearchEntry,
  session: BotSession,
): Promise<BotReply> {
  const type = session.type!;
  session.selected = { type, id: entry.id, name: entry.name };
  const result = await getSchedule(type, entry.id, entry.name);

  if (!result.ok) {
    // isuct.ru unreachable — show error, NOT demo data
    session.state = "enter_query";
    session.selected = undefined;
    return {
      text: result.error,
      keyboard: kBackToType(),
      session,
      edit: false,
    };
  }

  const schedule = result.schedule;
  session.schedule = schedule;
  session.weekViewParity = schedule.currentParity;
  session.state = "schedule_menu";
  return {
    text: `${renderScheduleHeader(schedule)}\n\nЧто показать?`,
    keyboard: kScheduleMenu(session.__chatId),
    session,
    edit: false,
  };
}

async function ensureSchedule(session: BotSession): Promise<FullSchedule | null> {
  if (!session.selected) return null;
  if (session.schedule && session.schedule.queryName === session.selected.name)
    return session.schedule;
  const result = await getSchedule(
    session.selected.type,
    session.selected.id,
    session.selected.name,
  );
  if (!result.ok) return null;
  session.schedule = result.schedule;
  return result.schedule;
}

// ─── Settings menu helpers ───────────────────────────────────────

/** Render the settings menu (reminders only). */
function handleSettingsMenu(
  session: BotSession,
  schedule: FullSchedule | null,
  settings: ReminderSettings,
): BotReply {
  const remIcon = settings.enabled ? "🟢" : "⚪";
  const remStatus = settings.enabled ? "Вкл" : "Выкл";
  const remMode =
    settings.mode === "lesson"
      ? `перед парой (${settings.leadMinutes} мин)`
      : `утром (${settings.dailyTime})`;

  const keyboard: InlineButton[][] = [
    [
      {
        text: settings.enabled ? "🔴 Выключить" : "🟢 Включить",
        callback_data: "remind:toggle",
      },
    ],
    [
      {
        text: settings.mode === "lesson" ? "● Перед парой" : "○ Перед парой",
        callback_data: "remind:mode:lesson",
      },
      {
        text: settings.mode === "daily" ? "● Утром" : "○ Утром",
        callback_data: "remind:mode:daily",
      },
    ],
  ];

  // Lead time options (lesson mode) — presets + custom
  if (settings.mode === "lesson") {
    keyboard.push(
      [5, 10, 15, 30].map((m) => ({
        text: settings.leadMinutes === m ? `● ${m} мин` : `${m} мин`,
        callback_data: `remind:lead:${m}`,
      })),
    );
    keyboard.push([
      { text: "✏️ Своё время (мин)", callback_data: "remind:lead:custom" },
    ]);
  }

  // Daily time options (daily mode) — presets + custom
  if (settings.mode === "daily") {
    keyboard.push(
      ["07", "08", "09"].map((h) => ({
        text: settings.dailyTime === `${h}:00` ? `● ${h}:00` : `${h}:00`,
        callback_data: `remind:daily:${h}`,
      })),
    );
    keyboard.push([
      { text: "✏️ Своё время (ЧЧ:ММ)", callback_data: "remind:daily:custom" },
    ]);
  }

  keyboard.push([{ text: "🔔 Проверить", callback_data: "remind:test" }]);
  keyboard.push([{ text: "↩ К расписанию", callback_data: "back:menu" }]);

  return {
    text:
      (schedule ? `${renderScheduleHeader(schedule)}\n\n` : "") +
      `${b("⚙️ Настройки")}\n\n` +
      `${b("🔔 Напоминания")}: ${remIcon} ${esc(remStatus)}\n` +
      `Режим: ${esc(remMode)}`,
    keyboard,
    session,
    edit: false,
  };
}

/** Fire a one-time test reminder for the next upcoming lesson. */
async function handleRemindTest(
  session: BotSession,
  schedule: FullSchedule | null,
  settings: ReminderSettings,
): Promise<BotReply> {
  if (!schedule)
    return {
      text: "Сначала выбери группу/преподавателя.",
      keyboard: K_TYPE_MENU,
      session,
    };

  const now = new Date();
  const day = jsDayToWeekDay(now.getDay());
  const parity = parityForDate(now);
  const week = schedule.weeks[parity];
  const daySched = week.days.find((d) => d.day === day);
  const nm = nowMin(now);

  let nextLesson: Lesson | null = null;
  if (daySched && daySched.lessons.length) {
    const sorted = [...daySched.lessons].sort((a, b) =>
      a.time.localeCompare(b.time),
    );
    const upcoming = sorted.find((l) => {
      const r = parseTimeRange(l.time);
      return r && r[0] > nm;
    });
    if (upcoming) nextLesson = upcoming;
  }

  if (!nextLesson) {
    const tmr = tomorrow();
    const tday = jsDayToWeekDay(tmr.getDay());
    const tpar = parityForDate(tmr);
    const tweek = schedule.weeks[tpar];
    const tSched = tweek.days.find((d) => d.day === tday);
    if (tSched && tSched.lessons.length) {
      const sorted = [...tSched.lessons].sort((a, b) =>
        a.time.localeCompare(b.time),
      );
      nextLesson = sorted[0];
    }
  }

  if (!nextLesson) {
    return {
      text:
        `${renderScheduleHeader(schedule)}\n\n` +
        `🔕 Ближайших пар не найдено. Напоминать не о чем. 🎉`,
      keyboard: [[{ text: "↩ К настройкам", callback_data: "remind:menu" }]],
      session,
      edit: false,
    };
  }

  const r = parseTimeRange(nextLesson.time);
  if (!r) {
    return {
      text: `⚠️ Не удалось определить время пары.`,
      keyboard: [[{ text: "↩ К настройкам", callback_data: "remind:menu" }]],
      session,
      edit: false,
    };
  }

  const lessonDate = new Date();
  if (r[0] <= nm) lessonDate.setDate(lessonDate.getDate() + 1);
  lessonDate.setHours(Math.floor(r[0] / 60), r[0] % 60, 0, 0);

  const leadMinutes = settings.leadMinutes;
  const reminderTime = new Date(
    lessonDate.getTime() - leadMinutes * 60_000,
  );
  const minsUntilLesson = Math.round(
    (lessonDate.getTime() - now.getTime()) / 60_000,
  );
  const minsUntilReminder = minsUntilLesson - leadMinutes;

  let message: string;
  if (minsUntilReminder <= 0 && minsUntilLesson > 0) {
    message = `🔔 Напомню прямо сейчас! До пары «${nextLesson.subject}» осталось ${minsUntilLesson} мин.`;
  } else if (minsUntilLesson > 0) {
    const hh = reminderTime.getHours().toString().padStart(2, "0");
    const mm = reminderTime.getMinutes().toString().padStart(2, "0");
    message = `🔔 Напомню за ${leadMinutes} мин. до пары «${nextLesson.subject}» (через ${minsUntilReminder} мин, в ${hh}:${mm}).`;
  } else {
    message = `🔔 Пара «${nextLesson.subject}» скоро начнётся!`;
  }

  // Store a one-time server-side reminder for the Telegram bot
  addReminder({
    chatId: session.__chatId || "",
    type: schedule.type,
    entityId: schedule.queryId,
    entityName: schedule.queryName,
    subject: nextLesson.subject,
    lessonTime: lessonDate.toISOString(),
    fireAt: reminderTime.getTime(),
    leadMinutes,
  });

  return {
    text:
      `${renderScheduleHeader(schedule)}\n\n` +
      `${b("🔔 Проверка напоминания")}\n\n` +
      `📚 ${esc(nextLesson.subject)}\n` +
      `⏰ ${esc(nextLesson.time)}\n\n` +
      `${esc(message)}\n\n` +
      `ℹ️ Браузер попросит разрешение на уведомления.`,
    keyboard: [[{ text: "↩ К настройкам", callback_data: "remind:menu" }]],
    session,
    edit: false,
    reminder: {
      lessonTime: lessonDate.toISOString(),
      subject: nextLesson.subject,
      leadMinutes,
      message,
    },
  };
}

/** Schedule a server-side reminder for the next lesson (used when enabling
 *  or changing settings in "lesson" mode). */
function scheduleLessonReminder(
  chatId: string,
  schedule: FullSchedule,
  settings: ReminderSettings,
): void {
  if (!settings.enabled || settings.mode !== "lesson") return;
  const now = new Date();
  const day = jsDayToWeekDay(now.getDay());
  const parity = parityForDate(now);
  const week = schedule.weeks[parity];
  const daySched = week.days.find((d) => d.day === day);
  const nm = nowMin(now);

  let nextLesson: Lesson | null = null;
  if (daySched && daySched.lessons.length) {
    const sorted = [...daySched.lessons].sort((a, b) =>
      a.time.localeCompare(b.time),
    );
    const upcoming = sorted.find((l) => {
      const r = parseTimeRange(l.time);
      return r && r[0] > nm;
    });
    if (upcoming) nextLesson = upcoming;
  }

  if (!nextLesson) {
    const tmr = tomorrow();
    const tday = jsDayToWeekDay(tmr.getDay());
    const tpar = parityForDate(tmr);
    const tweek = schedule.weeks[tpar];
    const tSched = tweek.days.find((d) => d.day === tday);
    if (tSched && tSched.lessons.length) {
      const sorted = [...tSched.lessons].sort((a, b) =>
        a.time.localeCompare(b.time),
      );
      nextLesson = sorted[0];
    }
  }

  if (!nextLesson) return;
  const r = parseTimeRange(nextLesson.time);
  if (!r) return;

  const lessonDate = new Date();
  if (r[0] <= nm) lessonDate.setDate(lessonDate.getDate() + 1);
  lessonDate.setHours(Math.floor(r[0] / 60), r[0] % 60, 0, 0);
  const reminderTime = new Date(
    lessonDate.getTime() - settings.leadMinutes * 60_000,
  );

  addReminder({
    chatId,
    type: schedule.type,
    entityId: schedule.queryId,
    entityName: schedule.queryName,
    subject: nextLesson.subject,
    lessonTime: lessonDate.toISOString(),
    fireAt: reminderTime.getTime(),
    leadMinutes: settings.leadMinutes,
  });
}

// ─── Admin panel ─────────────────────────────────────────────────
const ADMIN_USERNAME = "jamqwr";

/** Handle admin commands. Only @jamqwr can access. */
async function handleAdmin(session: BotSession, text: string): Promise<BotReply> {
  const isAdmin = session.__isAdmin === true;
  if (!isAdmin) {
    return {
      text: "⛔ У вас нет доступа к админ-панели.",
      keyboard: K_TYPE_MENU,
      session,
      edit: false,
    };
  }

  const cmd = text.toLowerCase().trim();

  if (cmd === "/admin" || cmd === "/admin help") {
    const analytics = getAnalytics();
    const popular = getPopular(5);
    const popularText = popular.length
      ? popular.map((p, i) => `${i + 1}. ${p.name} (${p.count})`).join("\n")
      : "Нет данных";
    return {
      text:
        `${b("🔧 Админ-панель ISUCT Schedule Reborn")}\n\n` +
        `${b("📊 Статистика:")}\n` +
        `• Сессий: ${analytics.sessions}\n` +
        `• Поисков: ${analytics.searches}\n` +
        `• Просмотров расписания: ${analytics.scheduleViews}\n` +
        `• Напоминаний установлено: ${analytics.remindersSet}\n` +
        `• Напоминаний отправлено: ${analytics.remindersFired}\n` +
        `• Уникальных групп: ${analytics.uniqueGroups}\n` +
        `• Уникальных преподавателей: ${analytics.uniqueTeachers}\n` +
        `• Uptime: ${analytics.uptimeMinutes} мин\n\n` +
        `${b("🔥 Популярные группы:")}\n${esc(popularText)}\n\n` +
        `${b("📝 Команды:")}\n` +
        `/admin — эта панель\n` +
        `/admin stats — только статистика\n` +
        `/admin cache — очистить кэш расписаний\n` +
        `/admin test — проверить доступность isuct.ru\n` +
        `/admin broadcast <текст> — рассылка всем\n` +
        `/admin restart — сбросить сессию\n` +
        `/admin sessions — список активных сессий`,
      keyboard: [[{ text: "↩ К расписанию", callback_data: "back:menu" }]],
      session,
      edit: false,
    };
  }

  if (cmd === "/admin stats") {
    const analytics = getAnalytics();
    return {
      text:
        `${b("📊 Статистика")}\n\n` +
        `• Сессий: ${analytics.sessions}\n` +
        `• Поисков: ${analytics.searches}\n` +
        `• Просмотров: ${analytics.scheduleViews}\n` +
        `• Напоминаний: ${analytics.remindersSet} (отправлено: ${analytics.remindersFired})\n` +
        `• Групп: ${analytics.uniqueGroups}\n` +
        `• Преподавателей: ${analytics.uniqueTeachers}\n` +
        `• Uptime: ${analytics.uptimeMinutes} мин`,
      keyboard: [[{ text: "↩ Назад", callback_data: "settings:menu" }]],
      session,
      edit: false,
    };
  }

  if (cmd === "/admin cache") {
    const cleared = clearScheduleCache();
    return {
      text: `✅ Кэш очищен: ${cleared} записей удалено.\nСледующие запросы возьмут свежие данные с isuct.ru.`,
      keyboard: [[{ text: "↩ К расписанию", callback_data: "back:menu" }]],
      session,
      edit: false,
    };
  }

  if (cmd === "/admin test") {
    // Test isuct.ru connectivity
    return {
      text:
        `${b("🔌 Проверка isuct.ru")}\n\n` +
        `Выполняется проверка доступности сайта...\n\n` +
        `Результат будет показан в следующем сообщении.`,
      keyboard: [[{ text: "↩ К расписанию", callback_data: "back:menu" }]],
      session,
      edit: false,
    };
  }

  if (cmd.startsWith("/admin broadcast ")) {
    const message = text.substring("/admin broadcast ".length).trim();
    if (!message) {
      return {
        text: "⚠️ Введите текст: /admin broadcast <текст>",
        keyboard: [[{ text: "↩ К расписанию", callback_data: "back:menu" }]],
        session,
        edit: false,
      };
    }
    session.__broadcast = message;
    return {
      text: `📢 Рассылка запланирована:\n\n${esc(message)}\n\nБудет отправлена при следующей проверке.`,
      keyboard: [[{ text: "↩ К расписанию", callback_data: "back:menu" }]],
      session,
      edit: false,
    };
  }

  if (cmd === "/admin restart") {
    session.selected = undefined;
    session.schedule = undefined;
    session.state = "menu_type";
    return {
      text: "🔄 Сессия сброшена.",
      keyboard: K_TYPE_MENU,
      session,
      edit: false,
    };
  }

  if (cmd === "/admin sessions") {
    return {
      text:
        `${b("👥 Активные сессии")}\n\n` +
        `Сессионное хранилище in-memory.\n` +
        `Каждая сессия живёт 1 час после последней активности.\n\n` +
        `Для детального просмотра используйте /admin stats.`,
      keyboard: [[{ text: "↩ К расписанию", callback_data: "back:menu" }]],
      session,
      edit: false,
    };
  }

  return {
    text: "Неизвестная команда. /admin — список команд.",
    keyboard: [[{ text: "↩ К расписанию", callback_data: "back:menu" }]],
    session,
    edit: false,
  };
}

async function handleCallback(
  data: string,
  session: BotSession,
): Promise<BotReply> {
  // type choice
  if (data.startsWith("t:")) {
    const type = data.slice(2) as ScheduleType;
    session.type = type;
    session.state = "enter_query";
    session.results = undefined;
    session.selected = undefined;
    session.schedule = undefined;
    return {
      text:
        `${b(TYPE_PROMPT[type])}\n` +
        `Вводи текст (${esc(TYPE_PLACEHOLDER[type])}).`,
      keyboard: kBackToType(),
      session,
    };
  }

  if (data === "back:type") {
    session.state = "menu_type";
    session.type = undefined;
    session.results = undefined;
    session.selected = undefined;
    session.schedule = undefined;
    return buildTypeMenuReply(session, "Выбери, для кого нужно расписание");
  }

  // quick-pick a popular group/teacher directly (engine-injected buttons)
  if (data.startsWith("pick:")) {
    const parts = data.split(":");
    // format: pick:<type>:<id>:<encodedName>
    if (parts.length >= 4) {
      const pickType = parts[1] as ScheduleType;
      const pickId = parts[2];
      const pickName = decodeURIComponent(parts.slice(3).join(":"));
      if (pickName) {
        session.type = pickType;
        session.state = "enter_query";
        session.results = undefined;
        session.selected = undefined;
        session.schedule = undefined;
        return selectEntity(
          { id: pickId, name: pickName },
          session,
        );
      }
    }
    // malformed → fall through to type menu
    return buildTypeMenuReply(session, "Выбери, для кого нужно расписание");
  }

  // resume:<type>:<id>:<name> — quick-resume a previously-selected entity
  // (shown as "▶ Продолжить" button on /start in the Telegram bot).
  if (data.startsWith("resume:")) {
    const parts = data.split(":");
    if (parts.length >= 4) {
      const rType = parts[1] as ScheduleType;
      const rId = parts[2];
      const rName = decodeURIComponent(parts.slice(3).join(":"));
      if (rName) {
        session.type = rType;
        session.state = "enter_query";
        session.results = undefined;
        session.selected = undefined;
        session.schedule = undefined;
        return selectEntity(
          { id: rId, name: rName },
          session,
        );
      }
    }
    return buildTypeMenuReply(session, "Выбери, для кого нужно расписание");
  }

  // select from search results
  if (data.startsWith("sel:")) {
    const idx = Number(data.slice(4));
    const results = session.results || [];
    const entry = results[idx];
    if (!entry) {
      return {
        text: "Элемент больше неактуален. Повтори поиск.",
        keyboard: kBackToType(),
        session,
      };
    }
    return selectEntity(entry, session);
  }

  if (data === "act:change") {
    session.state = "enter_query";
    session.results = undefined;
    session.selected = undefined;
    session.schedule = undefined;
    return {
      text: `Введи ${b(TYPE_LABEL[session.type!])} (${esc(TYPE_PLACEHOLDER[session.type!])}).`,
      keyboard: kBackToType(),
      session,
    };
  }

  // schedule menu actions
  if (data === "act:today" || data === "act:tomorrow") {
    const schedule = await ensureSchedule(session);
    if (!schedule)
      return { text: "Сначала выбери группу/преподавателя.", keyboard: K_TYPE_MENU, session };
    const date = data === "act:today" ? new Date() : tomorrow();
    const day = jsDayToWeekDay(date.getDay());
    const parity = parityForDate(date);
    const isToday = data === "act:today";
    const title =
      `${renderScheduleHeader(schedule)}\n\n` +
      `${isToday ? "📌 Сегодня" : "👉 Завтра"}, ${esc(fmtDate(date))}`;
    return {
      // Highlight current/next lesson only when viewing today
      text: renderDay(schedule, parity, day, title, isToday),
      keyboard: kScheduleMenu(session.__chatId),
      session,
      edit: false,
      isSchedule: true,
    };
  }

  if (data === "act:week") {
    const schedule = await ensureSchedule(session);
    if (!schedule)
      return { text: "Сначала выбери группу/преподавателя.", keyboard: K_TYPE_MENU, session };
    session.state = "week_days";
    session.weekViewParity = session.weekViewParity || schedule.currentParity;
    return {
      text:
        `${renderScheduleHeader(schedule)}\n\n` +
        `Выбери день недели (неделя: ${b(session.weekViewParity)}):`,
      keyboard: kWeekDays(session.weekViewParity),
      session,
      edit: false,
    };
  }

  if (data === "act:now") {
    const schedule = await ensureSchedule(session);
    if (!schedule)
      return { text: "Сначала выбери группу/преподавателя.", keyboard: K_TYPE_MENU, session };
    session.state = "schedule_menu";
    return {
      text: renderNow(schedule),
      keyboard: kScheduleMenu(session.__chatId),
      session,
      edit: false,
      isSchedule: true,
    };
  }

  if (data === "act:fullweek") {
    const schedule = await ensureSchedule(session);
    if (!schedule)
      return { text: "Сначала выбери группу/преподавателя.", keyboard: K_TYPE_MENU, session };
    session.state = "schedule_menu";
    const parity = session.weekViewParity || schedule.currentParity;
    return {
      text: renderFullWeek(schedule, parity),
      keyboard: kScheduleMenu(session.__chatId),
      session,
      edit: false,
      isSchedule: true,
    };
  }

  // ─── Settings: reminders ───────────────────────────────────────
  if (data.startsWith("remind:") || data === "settings:menu") {
    const chatId = session.__chatId || "";
    const schedule = await ensureSchedule(session);
    const settings: ReminderSettings = session.reminderSettings || {
      enabled: false,
      mode: "lesson",
      leadMinutes: 5,
      dailyTime: "07:00",
    };
    updateSettings(chatId, settings);

    const saveSettings = (s: ReminderSettings): ReminderSettings => {
      session.reminderSettings = s;
      updateSettings(chatId, s);
      return s;
    };

    // settings:menu — show the settings menu
    if (data === "settings:menu") {
      session.state = "schedule_menu";
      return handleSettingsMenu(session, schedule, settings);
    }

    const action = data.slice(7); // after "remind:" (7 chars)

    if (action === "menu") {
      session.state = "schedule_menu";
      return handleSettingsMenu(session, schedule, settings);
    }

    // remind:toggle — enable / disable
    if (action === "toggle") {
      const newSettings = saveSettings({ ...settings, enabled: !settings.enabled });
      if (newSettings.enabled && schedule) {
        scheduleLessonReminder(chatId, schedule, newSettings);
        incRemindersSet();
      }
      return handleSettingsMenu(session, schedule, newSettings);
    }

    // remind:mode:lesson | remind:mode:daily
    if (action.startsWith("mode:")) {
      const mode = action.slice(5) as "lesson" | "daily";
      const newSettings = saveSettings({ ...settings, mode });
      if (newSettings.enabled && schedule) {
        scheduleLessonReminder(chatId, schedule, newSettings);
      }
      return handleSettingsMenu(session, schedule, newSettings);
    }

    // remind:lead:custom — enter custom lead time input mode
    if (action === "lead:custom") {
      session.state = "enter_custom_lead";
      return {
        text:
          (schedule ? `${renderScheduleHeader(schedule)}\n\n` : "") +
          `${b("✏️ Своё время до пары")}\n\n` +
          `Введи количество минут (1–120):`,
        keyboard: [[{ text: "↩ Отмена", callback_data: "settings:menu" }]],
        session,
        edit: false,
      };
    }

    // remind:lead:5 | remind:lead:10 | remind:lead:15 | remind:lead:30
    if (action.startsWith("lead:")) {
      const lead = Number(action.slice(5));
      if (!Number.isNaN(lead) && lead >= 1 && lead <= 120) {
        const newSettings = saveSettings({ ...settings, leadMinutes: lead });
        if (newSettings.enabled && schedule) {
          scheduleLessonReminder(chatId, schedule, newSettings);
        }
        return handleSettingsMenu(session, schedule, newSettings);
      }
      return handleSettingsMenu(session, schedule, settings);
    }

    // remind:daily:custom — enter custom daily time input mode
    if (action === "daily:custom") {
      session.state = "enter_custom_time";
      return {
        text:
          (schedule ? `${renderScheduleHeader(schedule)}\n\n` : "") +
          `${b("✏️ Своё время утра")}\n\n` +
          `Введи время в формате ЧЧ:ММ (например, 06:30):`,
        keyboard: [[{ text: "↩ Отмена", callback_data: "settings:menu" }]],
        session,
        edit: false,
      };
    }

    // remind:daily:07 | remind:daily:08 | remind:daily:09
    if (action.startsWith("daily:")) {
      const hour = action.slice(6);
      if (/^\d{2}$/.test(hour)) {
        const newSettings = saveSettings({ ...settings, dailyTime: `${hour}:00` });
        return handleSettingsMenu(session, schedule, newSettings);
      }
      return handleSettingsMenu(session, schedule, settings);
    }

    // remind:test — fire a one-time test reminder for the next lesson
    if (action === "test") {
      return handleRemindTest(session, schedule, settings);
    }

    // Fallback
    return handleSettingsMenu(session, schedule, settings);
  }

  // ─── Pinned entities (multi-group) ─────────────────────────────
  // [TEMPORARILY DISABLED — Избранное feature commented out]
  //
  // if (data === "pin:add" || data.startsWith("pin:open:")) {
  //   const schedule = await ensureSchedule(session);
  //   if (!schedule)
  //     return { text: "Сначала выбери группу/преподавателя.", keyboard: K_TYPE_MENU, session };
  //   const chatId = session.__chatId || "";
  //   const entity = {
  //     type: schedule.type,
  //     id: schedule.queryId,
  //     name: schedule.queryName,
  //   };
  //   if (data.startsWith("pin:open:")) {
  //     const idx = Number(data.slice(9));
  //     const list = getPinned(chatId);
  //     const target = list[idx];
  //     if (target) {
  //       session.type = target.type;
  //       session.state = "enter_query";
  //       session.results = undefined;
  //       session.selected = undefined;
  //       session.schedule = undefined;
  //       return selectEntity(
  //         { id: target.id, name: target.name },
  //         session,
  //       );
  //     }
  //   } else {
  //     if (isPinned(chatId, entity.type, entity.id)) {
  //       removePinned(chatId, entity.type, entity.id);
  //     } else {
  //       addPinned(chatId, entity);
  //       incPins();
  //     }
  //   }
  //   const list = getPinned(chatId);
  //   if (list.length === 0) {
  //     return {
  //       text:
  //         `${renderScheduleHeader(schedule)}\n\n` +
  //         `📌 Список избранного пуст. Нажми «📌 В избранное», чтобы добавить.`,
  //       keyboard: kScheduleMenu(session.__chatId),
  //       session,
  //       edit: false,
  //     };
  //   }
  //   const lines = list
  //     .map(
  //       (e, i) =>
  //         `${i + 1}. ${TYPE_EMOJI_BY_TYPE[e.type]} ${esc(e.name)}` +
  //         (e.type === entity.type && e.id === entity.id ? " ✓" : ""),
  //     )
  //     .join("\n");
  //   const rows: InlineButton[][] = list.map((e, i) => [
  //     {
  //       text: `${TYPE_EMOJI_BY_TYPE[e.type]} ${e.name}`,
  //       callback_data: `pin:open:${i}`,
  //     },
  //   ]);
  //   rows.push([{ text: "↩ К расписанию", callback_data: "back:menu" }]);
  //   return {
  //     text:
  //       `${renderScheduleHeader(schedule)}\n\n` +
  //       `${b("📌 Избранное")} (${list.length}/${PINNED_LIMIT}):\n\n${lines}\n\n` +
  //       `Нажми на группу, чтобы открыть её расписание.`,
  //     keyboard: rows,
  //     session,
  //     edit: false,
  //   };
  // }
  //
  // if (data === "pin:list") {
  //   const chatId = session.__chatId || "";
  //   const list = getPinned(chatId);
  //   const schedule = session.schedule || (await ensureSchedule(session));
  //   if (list.length === 0) {
  //     return {
  //       text:
  //         (schedule ? `${renderScheduleHeader(schedule)}\n\n` : "") +
  //         `📌 Список избранного пуст.`,
  //       keyboard: kScheduleMenu(session.__chatId),
  //       session,
  //       edit: false,
  //     };
  //   }
  //   const rows: InlineButton[][] = list.map((e, i) => [
  //     {
  //       text: `${TYPE_EMOJI_BY_TYPE[e.type]} ${e.name}`,
  //       callback_data: `pin:open:${i}`,
  //     },
  //   ]);
  //   rows.push([{ text: "↩ К расписанию", callback_data: "back:menu" }]);
  //   return {
  //     text:
  //       (schedule ? `${renderScheduleHeader(schedule)}\n\n` : "") +
  //       `${b("📌 Избранное")} (${list.length}/${PINNED_LIMIT}):\n\n` +
  //       list
  //         .map((e, i) => `${i + 1}. ${TYPE_EMOJI_BY_TYPE[e.type]} ${esc(e.name)}`)
  //         .join("\n") +
  //       `\n\nНажми на группу, чтобы открыть.`,
  //     keyboard: rows,
  //     session,
  //     edit: false,
  //   };
  // }

  if (data.startsWith("wk:")) {
    const p = data.slice(3) as WeekParity;
    session.weekViewParity = p;
    session.state = "week_days";
    const schedule = await ensureSchedule(session);
    if (!schedule)
      return { text: "Сначала выбери группу/преподавателя.", keyboard: K_TYPE_MENU, session };
    return {
      text:
        `${renderScheduleHeader(schedule)}\n\n` +
        `Выбери день недели (неделя: ${b(p)}):`,
      keyboard: kWeekDays(p),
      session,
      edit: true,
    };
  }

  if (data.startsWith("day:")) {
    const day = Number(data.slice(4)) as WeekDayIndex;
    const schedule = await ensureSchedule(session);
    if (!schedule)
      return { text: "Сначала выбери группу/преподавателя.", keyboard: K_TYPE_MENU, session };
    const parity = session.weekViewParity || schedule.currentParity;
    return {
      text: renderDay(schedule, parity, day, renderScheduleHeader(schedule)),
      keyboard: kWeekDays(parity),
      session,
      edit: false,
      isSchedule: true,
    };
  }

  if (data === "back:menu") {
    if (!session.selected) {
      session.state = "menu_type";
      return { text: "Выбери, для кого нужно расписание:", keyboard: K_TYPE_MENU, session };
    }
    const schedule = session.schedule || (await ensureSchedule(session))!;
    session.state = "schedule_menu";
    return {
      text: `${renderScheduleHeader(schedule)}\n\nЧто показать?`,
      keyboard: kScheduleMenu(session.__chatId),
      session,
      edit: false,
    };
  }

  // unknown
  return {
    text: "Не понял команду. Воспользуйся кнопками или /start.",
    keyboard: K_TYPE_MENU,
    session,
  };
}

export function newSession(): BotSession {
  return { state: "menu_type" };
}
