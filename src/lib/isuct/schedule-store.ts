// Schedule store: in-memory cache + live-scrape.
// When isuct.ru is unreachable, returns an error (NOT sample data).
// The bot shows an error message to the user instead of fake schedule.

import type { FullSchedule, ScheduleType, SearchEntry, WeekParity } from "./types";
import { computeCurrentParity, fetchLiveSchedule, searchLive, validateQuery } from "./scraper";
import { generateSampleSchedule, searchSample } from "./sample-data";
import { incSearches, incScheduleViews } from "@/lib/bot/analytics";

const SEMESTOR_START = "2025-09-02";

interface CacheEntry<T> {
  value: T;
  expires: number;
}

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const cache = new Map<string, CacheEntry<unknown>>();

function getCache<T>(key: string): T | null {
  const e = cache.get(key) as CacheEntry<T> | undefined;
  if (!e) return null;
  if (Date.now() > e.expires) {
    cache.delete(key);
    return null;
  }
  return e.value;
}

function setCache<T>(key: string, value: T, ttl = TTL_MS) {
  cache.set(key, { value, expires: Date.now() + ttl });
  if (cache.size > 500) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
}

/** Validate a group/teacher/auditorium query format. */
export function validateSearchQuery(type: ScheduleType, query: string): string | null {
  return validateQuery(type, query);
}

/**
 * Search groups / teachers / auditoriums.
 * Tries live autocomplete first, falls back to curated sample list.
 * If nothing found and format is valid, returns the query itself as a result.
 */
export async function searchSchedule(
  type: ScheduleType,
  query: string,
): Promise<SearchEntry[]> {
  incSearches();
  const key = `search:${type}:${query.trim().toLowerCase()}`;
  const cached = getCache<SearchEntry[]>(key);
  if (cached) return cached;

  const live = await searchLive(type, query);
  let result = live.length ? live : searchSample(type, query);

  // If nothing found but format is valid, let the user proceed with their input.
  if (result.length === 0 && !validateQuery(type, query)) {
    const q = query.trim();
    result = [{ id: q, name: q }];
  }

  setCache(key, result, 5 * 60 * 1000);
  return result;
}

/**
 * Result of getSchedule — either a real schedule or an error.
 */
export type ScheduleResult =
  | { ok: true; schedule: FullSchedule }
  | { ok: false; error: string };

/**
 * Get the full schedule for a group / teacher / auditorium.
 * Tries live scrape. If isuct.ru is unreachable, returns an error
 * (does NOT fall back to sample data — user sees an error message).
 */
export async function getSchedule(
  type: ScheduleType,
  id: string,
  name: string,
): Promise<ScheduleResult> {
  incScheduleViews();
  const key = `sched:${type}:${id}:${name}`;
  const cached = getCache<FullSchedule>(key);
  if (cached) {
    recordView(type, id, name);
    return { ok: true, schedule: cached };
  }

  const live = await fetchLiveSchedule(type, id, name, SEMESTOR_START);
  if (live) {
    setCache(key, live);
    recordView(type, id, name);
    return { ok: true, schedule: live };
  }

  // No fallback to sample data — return error
  return {
    ok: false,
    error: "⚠️ Не удалось получить расписание с сайта университета (isuct.ru).\n\n" +
      "Возможные причины:\n" +
      "• Сайт временно недоступен\n" +
      "• Группа/преподаватель не найдены\n\n" +
      "Попробуйте позже или проверьте правильность ввода.",
  };
}

export function getCurrentParity(): WeekParity {
  return computeCurrentParity(SEMESTOR_START, "II");
}

export function getSemesterStart(): string {
  return SEMESTOR_START;
}

/** Clear all cached schedules (admin command). */
export function clearScheduleCache(): number {
  let count = 0;
  for (const key of cache.keys()) {
    if (key.startsWith("sched:") || key.startsWith("search:")) {
      cache.delete(key);
      count++;
    }
  }
  return count;
}

// ─── Popularity stats ─────────────────────────────────────────────

interface StatsEntry {
  type: ScheduleType;
  id: string;
  name: string;
  count: number;
  lastUsed: number;
}

const stats = new Map<string, StatsEntry>();

export function recordView(type: ScheduleType, id: string, name: string) {
  const key = `${type}:${id}`;
  const existing = stats.get(key);
  if (existing) {
    existing.count++;
    existing.lastUsed = Date.now();
    existing.name = name;
  } else {
    stats.set(key, { type, id, name, count: 1, lastUsed: Date.now() });
  }
}

export function getPopular(limit = 6): StatsEntry[] {
  const merged = new Map<string, StatsEntry>();
  for (const e of stats.values()) {
    const k = `${e.type}:${e.name}`;
    const cur = merged.get(k);
    if (!cur) {
      merged.set(k, { ...e });
    } else {
      cur.count += e.count;
      if (e.lastUsed > cur.lastUsed) {
        cur.lastUsed = e.lastUsed;
        cur.id = e.id;
      }
    }
  }
  return [...merged.values()]
    .sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed)
    .slice(0, limit);
}

export function getPopularByType(type: ScheduleType, limit = 4): StatsEntry[] {
  const merged = new Map<string, StatsEntry>();
  for (const e of stats.values()) {
    if (e.type !== type) continue;
    const k = e.name;
    const cur = merged.get(k);
    if (!cur) {
      merged.set(k, { ...e });
    } else {
      cur.count += e.count;
      if (e.lastUsed > cur.lastUsed) {
        cur.lastUsed = e.lastUsed;
        cur.id = e.id;
      }
    }
  }
  return [...merged.values()]
    .sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed)
    .slice(0, limit);
}
