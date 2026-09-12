// Schedule store: in-memory cache + live-scrape with automatic sample fallback.
// This is the single entry point the bot engine and API routes use.

import type { FullSchedule, ScheduleType, SearchEntry, WeekParity } from "./types";
import { computeCurrentParity, fetchLiveSchedule, searchLive } from "./scraper";
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
  // bound cache size
  if (cache.size > 500) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
}

/**
 * Search groups / teachers / auditoriums.
 * Tries live autocomplete first, falls back to curated sample list.
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
  const result = live.length ? live : searchSample(type, query);
  setCache(key, result, 5 * 60 * 1000);
  return result;
}

/**
 * Get the full schedule for a group / teacher / auditorium.
 * Tries live scrape first; on failure returns a deterministic sample schedule
 * (always flagged `source: 'sample'`) so the bot never breaks.
 */
export async function getSchedule(
  type: ScheduleType,
  id: string,
  name: string,
): Promise<FullSchedule> {
  incScheduleViews();
  const key = `sched:${type}:${id}:${name}`;
  const cached = getCache<FullSchedule>(key);
  if (cached) {
    recordView(type, id, name);
    return cached;
  }

  const currentParity = computeCurrentParity(SEMESTOR_START, "II");

  const live = await fetchLiveSchedule(type, id, name, SEMESTOR_START);
  if (live) {
    setCache(key, live);
    recordView(type, id, name);
    return live;
  }

  // Fallback: deterministic sample, but keep the real query name.
  const sample = generateSampleSchedule(type, name, SEMESTOR_START, currentParity);
  sample.queryId = id;
  sample.liveError = "Сайт isuct.ru недоступен — показано демонстрационное расписание";
  setCache(key, sample, 2 * 60 * 1000); // short TTL so live retries sooner
  recordView(type, id, name);
  return sample;
}

export function getCurrentParity(): WeekParity {
  return computeCurrentParity(SEMESTOR_START, "II");
}

export function getSemesterStart(): string {
  return SEMESTOR_START;
}

// ─── Popularity stats ─────────────────────────────────────────────
// Tracks how many times each group/teacher/auditorium has been viewed.
// Used to show "Популярные" suggestions on the start screen so new users
// can pick a common group without typing. In-memory only (resets on
// restart); for multi-instance deployments, swap with Redis.

interface StatsEntry {
  type: ScheduleType;
  id: string;
  name: string;
  count: number;
  lastUsed: number;
}

const stats = new Map<string, StatsEntry>(); // key = `${type}:${id}`

/** Record a view — called whenever a schedule is fetched. */
export function recordView(type: ScheduleType, id: string, name: string) {
  const key = `${type}:${id}`;
  const existing = stats.get(key);
  if (existing) {
    existing.count++;
    existing.lastUsed = Date.now();
    existing.name = name; // update in case display name changed
  } else {
    stats.set(key, { type, id, name, count: 1, lastUsed: Date.now() });
  }
}

/** Get the top-N most-viewed entities across all types. */
export function getPopular(limit = 6): StatsEntry[] {
  // Deduplicate by name+type (same group can be recorded under different IDs
  // when selected via different paths — e.g. sample-search id vs engine pick
  // id). Keep the highest-count entry per name+type, merging counts.
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
        cur.id = e.id; // prefer most-recently-used id
      }
    }
  }
  return [...merged.values()]
    .sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed)
    .slice(0, limit);
}

/** Get the top-N most-viewed entities of a specific type. */
export function getPopularByType(type: ScheduleType, limit = 4): StatsEntry[] {
  // Same dedup-by-name logic, scoped to one type.
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
