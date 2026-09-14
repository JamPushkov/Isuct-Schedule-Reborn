import type {
  FullSchedule,
  ScheduleType,
  SearchEntry,
  WeekParity,
} from "./types";

import {
  computeCurrentParity,
  fetchLiveSchedule,
  searchLive,
  validateQuery,
} from "./scraper";

import {
  searchSample,
} from "./sample-data";

import {
  incSearches,
  incScheduleViews,
} from "@/lib/bot/analytics";

/*
 * First Monday of the current autumn semester.
 *
 * The schedule response you showed contains:
 *   07.09.2026
 *   08.09.2026
 *   09.09.2026
 *   ...
 *
 * 07.09.2026 is Monday.
 */
const SEMESTER_START = "2026-09-07";

interface CacheEntry<T> {
  value: T;
  expires: number;
}

const TTL_MS =
  10 * 60 * 1000;

const cache =
  new Map<string, CacheEntry<unknown>>();

function getCache<T>(
  key: string,
): T | null {
  const entry =
    cache.get(key) as
      | CacheEntry<T>
      | undefined;

  if (!entry) {
    return null;
  }

  if (
    Date.now() >
    entry.expires
  ) {
    cache.delete(key);

    return null;
  }

  return entry.value;
}

function setCache<T>(
  key: string,
  value: T,
  ttl = TTL_MS,
) {
  cache.set(
    key,
    {
      value,
      expires:
        Date.now() + ttl,
    },
  );

  /*
   * Prevent unbounded memory usage
   * in a warm Vercel function.
   */
  if (cache.size > 500) {
    const firstKey =
      cache.keys().next().value;

    if (firstKey) {
      cache.delete(firstKey);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────

export function validateSearchQuery(
  type: ScheduleType,
  query: string,
): string | null {
  return validateQuery(
    type,
    query,
  );
}

export async function searchSchedule(
  type: ScheduleType,
  query: string,
): Promise<SearchEntry[]> {
  incSearches();

  const normalized =
    query.trim().toLowerCase();

  const key =
    `search:${type}:${normalized}`;

  const cached =
    getCache<SearchEntry[]>(key);

  if (cached) {
    return cached;
  }

  const live =
    await searchLive(
      type,
      query,
    );

  /*
   * Keep your old sample fallback only for search.
   *
   * It is NOT used when fetching the actual schedule.
   */
  const result =
    live.length > 0
      ? live
      : searchSample(
          type,
          query,
        );

  /*
   * If the user entered something plausible,
   * let them try it directly.
   *
   * This is useful when autocomplete temporarily fails.
   */
  if (
    result.length === 0 &&
    validateQuery(
      type,
      query,
    ) === null
  ) {
    const value =
      query.trim();

    if (value) {
      result.push({
        id: value,
        name: value,
      });
    }
  }

  setCache(
    key,
    result,
    5 * 60 * 1000,
  );

  return result;
}

// ─────────────────────────────────────────────────────────────
// Schedule
// ─────────────────────────────────────────────────────────────

export type ScheduleResult =
  | {
      ok: true;
      schedule: FullSchedule;
    }
  | {
      ok: false;
      error: string;
    };

export async function getSchedule(
  type: ScheduleType,
  id: string,
  name: string,
): Promise<ScheduleResult> {
  incScheduleViews();

  const key =
    `sched:${type}:${id}:${name}`;

  const cached =
    getCache<FullSchedule>(
      key,
    );

  if (cached) {
    recordView(
      type,
      id,
      name,
    );

    return {
      ok: true,
      schedule: cached,
    };
  }

  console.log(
    `[ISUCT] Fetching live schedule: type=${type}, name=${name}, id=${id}`,
  );

  const live =
    await fetchLiveSchedule(
      type,
      id,
      name,
      SEMESTER_START,
    );

  if (live) {
    setCache(
      key,
      live,
      10 * 60 * 1000,
    );

    recordView(
      type,
      id,
      name,
    );

    return {
      ok: true,
      schedule: live,
    };
  }

  return {
    ok: false,

    error:
      "⚠️ Не удалось получить расписание с сайта университета (isuct.ru).\n\n" +
      "Попробуйте ещё раз через несколько секунд.\n\n" +
      "Если ошибка повторяется, сайт университета может временно не отвечать.",
  };
}

// ─────────────────────────────────────────────────────────────
// Current week
// ─────────────────────────────────────────────────────────────

export function getCurrentParity(): WeekParity {
  return computeCurrentParity(
    SEMESTER_START,
    "I",
  );
}

export function getSemesterStart(): string {
  return SEMESTER_START;
}

// ─────────────────────────────────────────────────────────────
// Cache
// ─────────────────────────────────────────────────────────────

export function clearScheduleCache(): number {
  let deleted = 0;

  for (const key of cache.keys()) {
    if (
      key.startsWith("sched:") ||
      key.startsWith("search:")
    ) {
      cache.delete(key);
      deleted++;
    }
  }

  return deleted;
}

// ─────────────────────────────────────────────────────────────
// Popularity stats
// ─────────────────────────────────────────────────────────────

interface StatsEntry {
  type: ScheduleType;
  id: string;
  name: string;
  count: number;
  lastUsed: number;
}

const stats =
  new Map<string, StatsEntry>();

export function recordView(
  type: ScheduleType,
  id: string,
  name: string,
) {
  const key =
    `${type}:${id}`;

  const existing =
    stats.get(key);

  if (existing) {
    existing.count++;
    existing.lastUsed =
      Date.now();
    existing.name =
      name;

    return;
  }

  stats.set(
    key,
    {
      type,
      id,
      name,
      count: 1,
      lastUsed:
        Date.now(),
    },
  );
}

export function getPopular(
  limit = 6,
): StatsEntry[] {
  const merged =
    new Map<string, StatsEntry>();

  for (const entry of stats.values()) {
    const key =
      `${entry.type}:${entry.name}`;

    const current =
      merged.get(key);

    if (!current) {
      merged.set(
        key,
        { ...entry },
      );
      continue;
    }

    current.count +=
      entry.count;

    if (
      entry.lastUsed >
      current.lastUsed
    ) {
      current.lastUsed =
        entry.lastUsed;

      current.id =
        entry.id;
    }
  }

  return [
    ...merged.values(),
  ]
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.lastUsed -
          a.lastUsed,
    )
    .slice(0, limit);
}

export function getPopularByType(
  type: ScheduleType,
  limit = 4,
): StatsEntry[] {
  const merged =
    new Map<string, StatsEntry>();

  for (const entry of stats.values()) {
    if (
      entry.type !== type
    ) {
      continue;
    }

    const key =
      entry.name;

    const current =
      merged.get(key);

    if (!current) {
      merged.set(
        key,
        { ...entry },
      );
      continue;
    }

    current.count +=
      entry.count;

    if (
      entry.lastUsed >
      current.lastUsed
    ) {
      current.lastUsed =
        entry.lastUsed;

      current.id =
        entry.id;
    }
  }

  return [
    ...merged.values(),
  ]
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.lastUsed -
          a.lastUsed,
    )
    .slice(0, limit);
}