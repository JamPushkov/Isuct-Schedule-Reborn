"use client";

import { useEffect, useState } from "react";
import {
  Users,
  Search,
  CalendarDays,
  Bell,
  Pin,
  TrendingUp,
  Clock,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface AnalyticsData {
  sessions: number;
  searches: number;
  scheduleViews: number;
  remindersSet: number;
  remindersFired: number;
  pinsAdded: number;
  photosRequested: number;
  uniqueGroups: number;
  uniqueTeachers: number;
  uniqueAuditoriums: number;
  popularGroups: { name: string; count: number }[];
  uptimeMinutes: number;
}

const CARDS = [
  { key: "sessions", label: "Сессий", icon: Users, color: "emerald" },
  { key: "scheduleViews", label: "Просмотров расписания", icon: CalendarDays, color: "teal" },
  { key: "searches", label: "Поисков", icon: Search, color: "sky" },
  { key: "remindersSet", label: "Напоминаний", icon: Bell, color: "violet" },
  { key: "pinsAdded", label: "Добавлений в избранное", icon: Pin, color: "rose" },
] as const;

const COLOR_MAP: Record<string, { bg: string; text: string; border: string }> = {
  emerald: { bg: "bg-emerald-50 dark:bg-emerald-950/30", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-200 dark:border-emerald-800/50" },
  teal: { bg: "bg-teal-50 dark:bg-teal-950/30", text: "text-teal-700 dark:text-teal-300", border: "border-teal-200 dark:border-teal-800/50" },
  sky: { bg: "bg-sky-50 dark:bg-sky-950/30", text: "text-sky-700 dark:text-sky-300", border: "border-sky-200 dark:border-sky-800/50" },
  amber: { bg: "bg-amber-50 dark:bg-amber-950/30", text: "text-amber-700 dark:text-amber-300", border: "border-amber-200 dark:border-amber-800/50" },
  violet: { bg: "bg-violet-50 dark:bg-violet-950/30", text: "text-violet-700 dark:text-violet-300", border: "border-violet-200 dark:border-violet-800/50" },
  rose: { bg: "bg-rose-50 dark:bg-rose-950/30", text: "text-rose-700 dark:text-rose-300", border: "border-rose-200 dark:border-rose-800/50" },
};

export function AnalyticsDashboard() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stats/overview", { cache: "no-store" });
      const d = await res.json();
      setData(d);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  if (loading && !data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-2xl bg-muted/50"
          />
        ))}
      </div>
    );
  }

  if (!data) return null;

  const maxPopular = Math.max(...data.popularGroups.map((g) => g.count), 1);

  return (
    <div className="space-y-6">
      {/* Uptime banner */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock className="h-3.5 w-3.5" />
        <span>Сервер работает: {data.uptimeMinutes} мин</span>
        <span className="mx-2">·</span>
        <span>Уникальных: {data.uniqueGroups} групп, {data.uniqueTeachers} преподавателей, {data.uniqueAuditoriums} аудиторий</span>
      </div>

      {/* Metric cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((card, i) => {
          const value = data[card.key as keyof AnalyticsData] as number;
          const colors = COLOR_MAP[card.color];
          return (
            <motion.div
              key={card.key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.05 }}
              className={cn(
                "relative overflow-hidden rounded-2xl border p-4",
                colors.bg,
                colors.border,
              )}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs font-medium text-muted-foreground">
                    {card.label}
                  </div>
                  <div className={cn("mt-1 text-3xl font-bold tabular-nums", colors.text)}>
                    {value}
                  </div>
                </div>
                <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl bg-white/60 dark:bg-white/5")}>
                  <card.icon className={cn("h-5 w-5", colors.text)} />
                </div>
              </div>
              {card.key === "remindersSet" && data.remindersFired > 0 && (
                <div className="mt-2 text-[10px] text-muted-foreground">
                  Сработало: {data.remindersFired}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Popular groups chart */}
      {data.popularGroups.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-600" />
            <h3 className="text-sm font-semibold">Популярные группы</h3>
            <span className="ml-auto text-xs text-muted-foreground">
              {data.popularGroups.length} групп
            </span>
          </div>
          <div className="space-y-2">
            {data.popularGroups.map((g, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="w-12 shrink-0 truncate text-xs font-medium text-muted-foreground">
                  {g.name}
                </span>
                <div className="h-6 flex-1 overflow-hidden rounded-md bg-muted/40">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(g.count / maxPopular) * 100}%` }}
                    transition={{ duration: 0.6, delay: i * 0.08, ease: "easeOut" }}
                    className="flex h-full items-center justify-end rounded-md bg-gradient-to-r from-emerald-500 to-teal-500 px-2 text-[10px] font-bold text-white"
                  >
                    {g.count}
                  </motion.div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
