// Analytics store: lightweight in-memory counters for the dashboard.
// Tracks aggregate events (sessions, searches, schedule views, reminders,
// pins, photo exports) so the admin dashboard can show usage metrics.
// In-memory only; swap with Redis for production multi-instance.

interface AnalyticsSnapshot {
  sessions: number;
  searches: number;
  scheduleViews: number;
  remindersSet: number;
  remindersFired: number;
  pinsAdded: number;
  popularGroups: { name: string; count: number }[];
  uniqueGroups: number;
  uniqueTeachers: number;
  uniqueAuditoriums: number;
  startedAt: number;
}

const counters = {
  sessions: 0,
  searches: 0,
  scheduleViews: 0,
  remindersSet: 0,
  remindersFired: 0,
  pinsAdded: 0,
};
const startedAt = Date.now();

export function incSessions() {
  counters.sessions++;
}
export function incSearches() {
  counters.searches++;
}
export function incScheduleViews() {
  counters.scheduleViews++;
}
export function incRemindersSet() {
  counters.remindersSet++;
}
export function incRemindersFired() {
  counters.remindersFired++;
}
export function incPins() {
  counters.pinsAdded++;
}

import { getPopular, getPopularByType } from "@/lib/isuct/schedule-store";

export function getAnalytics(): AnalyticsSnapshot {
  const allPopular = getPopular(20);
  const popularGroups = allPopular
    .filter((e) => e.type === "group")
    .slice(0, 10)
    .map((e) => ({ name: e.name, count: e.count }));
  return {
    ...counters,
    popularGroups,
    uniqueGroups: getPopularByType("group", 100).length,
    uniqueTeachers: getPopularByType("teacher", 100).length,
    uniqueAuditoriums: getPopularByType("auditorium", 100).length,
    startedAt,
  };
}
