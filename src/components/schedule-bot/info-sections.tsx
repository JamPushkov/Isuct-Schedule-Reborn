"use client";

import { useState } from "react";
import {
  Clock,
  ChevronDown,
  HelpCircle,
  Bell,
  CalendarRange,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BELL_SLOTS = [
  { n: 1, time: "08:30 — 10:05", note: "1-я пара" },
  { n: 2, time: "10:15 — 11:50", note: "2-я пара" },
  { n: 3, time: "12:30 — 14:05", note: "3-я пара" },
  { n: 4, time: "14:15 — 15:50", note: "4-я пара" },
  { n: 5, time: "16:00 — 17:35", note: "5-я пара" },
  { n: 6, time: "17:45 — 19:20", note: "6-я пара" },
  { n: 7, time: "19:30 — 21:05", note: "вечерняя" },
];

const FAQ = [
  {
    q: "Откуда берётся расписание?",
    a: "Напрямую с официального сайта ИГХТУ — isuct.ru/student/schedule. Бот обращается к нему в реальном времени и кэширует результат на 10 минут, чтобы отвечать мгновенно.",
  },
  {
    q: "Как определяется текущая неделя (I или II)?",
    a: "Отсчёт ведётся от начала семестра. На странице расписания указано, с какой недели начинается учёба (например, «со 2 сентября, среда II неделя»). Бот вычисляет паритет автоматически для любой даты.",
  },
  {
    q: "Что делать, если расписание не обновилось?",
    a: "Данные кэшируются 10 минут. Подождите немного или нажмите «🔄 Сменить» и выберите группу заново — это сбросит кэш для вашей сессии.",
  },
  {
    q: "Можно ли узнать, какая пара сейчас идёт?",
    a: "Да! Нажмите кнопку «⏱ Сейчас» — бот покажет текущую пару (с остатком времени) или следующую пару сегодня, или заглянет в завтра.",
  },
  {
    q: "Бот официальный?",
    a: "Нет, это неофициальный проект, созданный студентами для удобства. Все данные берутся из открытых источников. Официальное расписание — на сайте университета.",
  },
  {
    q: "Как запустить своего бота?",
    a: "Создайте бота через @BotFather в Telegram, получите токен, вставьте его в секцию «Подключите своего бота» на этой странице — и следуйте инструкциям по настройке webhook.",
  },
];

function BellSchedule() {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          <Bell className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Расписание звонков</h3>
          <p className="text-xs text-muted-foreground">
            Время начала и окончания пар
          </p>
        </div>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {BELL_SLOTS.map((s) => (
          <div
            key={s.n}
            className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 transition hover:border-amber-300/60 hover:bg-amber-50/40 dark:hover:bg-amber-950/10"
          >
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-600 text-[11px] font-bold text-white">
              {s.n}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[13px] font-medium tabular-nums">
                {s.time}
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground">{s.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FaqItem({
  q,
  a,
  defaultOpen,
}: {
  q: string;
  a: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm transition hover:shadow-md">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-muted/40"
        aria-expanded={open}
      >
        <HelpCircle className="h-4 w-4 shrink-0 text-emerald-600" />
        <span className="flex-1 text-sm font-medium">{q}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      <div
        className={cn(
          "grid transition-all duration-200",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <p className="px-4 pb-4 pl-11 text-sm leading-relaxed text-muted-foreground">
            {a}
          </p>
        </div>
      </div>
    </div>
  );
}

export function InfoSections() {
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
      <div>
        <div className="mb-4 flex items-center gap-2">
          <Clock className="h-5 w-5 text-amber-600" />
          <h2 className="text-xl font-bold">Полезная информация</h2>
        </div>
        <p className="mb-6 text-sm text-muted-foreground">
          Время пар и ответы на частые вопросы — всё в одном месте.
        </p>
        <BellSchedule />
      </div>
      <div>
        <div className="mb-4 flex items-center gap-2">
          <CalendarRange className="h-5 w-5 text-emerald-600" />
          <h2 className="text-xl font-bold">Частые вопросы</h2>
        </div>
        <p className="mb-6 text-sm text-muted-foreground">
          Всё, что нужно знать о работе бота.
        </p>
        <div className="space-y-2.5">
          {FAQ.map((f, i) => (
            <FaqItem key={i} q={f.q} a={f.a} defaultOpen={i === 0} />
          ))}
        </div>
      </div>
    </div>
  );
}
