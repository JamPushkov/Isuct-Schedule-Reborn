// Production-ready ISUCT schedule scraper.
//
// NOTE: z-ai-web-dev-sdk / page_reader is a *backend-only* tool, but it only
// performs GET requests on the SDK service. The real bot needs POST + cookies
// to drive the Drupal `studschedule_form`. So this module uses the host's own
// `fetch` (server-side) to talk to isuct.ru directly. When the host cannot
// reach isuct.ru (e.g. this sandbox), every method fails fast and the caller
// falls back to sample data — so the bot keeps working.

import * as cheerio from "cheerio";
import type {
  DaySchedule,
  FullSchedule,
  Lesson,
  ScheduleType,
  SearchEntry,
  WeekDayIndex,
  WeekParity,
} from "./types";
import { DAY_NAMES_FULL, SCHEDULE_BASE_URL } from "./types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const AUTOCOMPLETE_PATH: Record<ScheduleType, string> = {
  group: "currentstudentsgroups",
  teacher: "prepod",
  auditorium: "auditorium",
};

const TYPE_FIELD: Record<ScheduleType, string> = {
  group: "currentstudentsgroups",
  teacher: "prepod",
  auditorium: "auditorium",
};

const TEXT_FIELD: Record<ScheduleType, string> = {
  group: "idgr",
  teacher: "idprep",
  auditorium: "idaud",
};

const ID_FIELD: Record<ScheduleType, string> = {
  group: "idgrid",
  teacher: "idprepid",
  auditorium: "idaudid",
};

function withTimeout(ms: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(t) };
}

// ─── Circuit breaker ───────────────────────────────────────────────
// When isuct.ru is unreachable (sandbox, firewall, downtime), every live
// attempt would block for the full timeout (10-20s) before falling back.
// The circuit breaker remembers a failure and short-circuits subsequent
// attempts for a cooldown period, so users get instant sample data instead
// of a 15-second hang on every single message.

const CB_OPEN_MS = 5 * 60 * 1000; // 5 min cooldown after a failure
let cbLastFailure = 0;
let cbProbeInflight = false;

/** Returns true if we should SKIP the live attempt (circuit open). */
function circuitOpen(): boolean {
  if (cbProbeInflight) return false;
  return Date.now() - cbLastFailure < CB_OPEN_MS;
}

/** Mark a failure so the circuit opens for the cooldown window. */
function recordFailure() {
  cbLastFailure = Date.now();
}

/** Allow one in-flight probe to test recovery without blocking users. */
function startProbe() {
  cbProbeInflight = true;
}
function endProbe() {
  cbProbeInflight = false;
}

interface FormContext {
  buildId: string;
  cookie: string;
}

/** GET the schedule page and extract a fresh form_build_id + session cookie. */
export async function getFormContext(): Promise<FormContext | null> {
  if (circuitOpen()) return null;
  startProbe();
  try {
    const { signal, clear } = withTimeout(5000);
    const res = await fetch(SCHEDULE_BASE_URL, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
      },
      signal,
      redirect: "follow",
    });
    clear();
    if (!res.ok) {
      recordFailure();
      return null;
    }
    const html = await res.text();
    const setCookie = res.headers.get("set-cookie") || "";
    const cookie = setCookie.split(";")[0]; // keep SSESSxxxx=...
    const $ = cheerio.load(html);
    const buildId =
      $('input[name="form_build_id"]').attr("value") ||
      html.match(/name="form_build_id"\s+value="([^"]+)"/)?.[1] ||
      "";
    if (!buildId) {
      recordFailure();
      return null;
    }
    return { buildId, cookie };
  } catch {
    recordFailure();
    return null;
  } finally {
    endProbe();
  }
}

/** Decode a Drupal autocomplete JSON response (array OR object form). */
function parseAutocomplete(json: string): SearchEntry[] {
  const out: SearchEntry[] = [];
  try {
    const data = JSON.parse(json);
    if (Array.isArray(data)) {
      for (const item of data) {
        if (typeof item === "string") {
          out.push({ id: item, name: item });
        } else if (item && typeof item === "object") {
          const label = String(item.label ?? item.value ?? item.name ?? "").trim();
          const value = String(item.value ?? item.id ?? "").trim();
          if (!label) continue;
          // Drupal often encodes the id in value like "Name [id:123]"
          const idMatch = value.match(/\[id:(\d+)\]/) || label.match(/\[(\d+)\]/);
          const id = idMatch ? idMatch[1] : value;
          out.push({ id, name: label.replace(/\s*\[.*?\]\s*$/, "") });
        }
      }
    } else if (data && typeof data === "object") {
      for (const [id, name] of Object.entries(data)) {
        out.push({ id, name: String(name) });
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

/** Search groups / teachers / auditoriums via the isuct.ru autocomplete. */
export async function searchLive(
  type: ScheduleType,
  query: string,
): Promise<SearchEntry[]> {
  const q = query.trim();
  if (!q) return [];
  if (circuitOpen()) return [];
  startProbe();
  try {
    const path = AUTOCOMPLETE_PATH[type];
    const url = `https://www.isuct.ru/student/schedule/${path}/${encodeURIComponent(q)}`;
    const { signal, clear } = withTimeout(4000);
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "ru-RU,ru;q=0.9",
        "X-Requested-With": "XMLHttpRequest",
      },
      signal,
    });
    clear();
    if (!res.ok) {
      recordFailure();
      return [];
    }
    const text = await res.text();
    const parsed = parseAutocomplete(text);
    // An empty array is a valid "no matches" — don't penalize the circuit.
    return parsed;
  } catch {
    recordFailure();
    return [];
  } finally {
    endProbe();
  }
}

/** Determine the current week parity from a reference anchor date. */
export function computeCurrentParity(
  semesterStartISO: string,
  startParity: WeekParity = "II",
  now: Date = new Date(),
): WeekParity {
  const start = new Date(semesterStartISO + "T00:00:00");
  if (Number.isNaN(start.getTime())) return startParity;
  const dayMs = 24 * 60 * 60 * 1000;
  // Move to the Monday of the anchor week for a stable week count.
  const startMonday = new Date(start);
  startMonday.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const nowMonday = new Date(now);
  nowMonday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const weeks = Math.round((nowMonday.getTime() - startMonday.getTime()) / (7 * dayMs));
  if (weeks < 0) return startParity;
  return weeks % 2 === 0 ? startParity : startParity === "I" ? "II" : "I";
}

const DAY_LOOKUP: Record<string, WeekDayIndex> = {
  понедельник: 1,
  вторник: 2,
  среда: 3,
  среду: 3,
  четверг: 4,
  пятница: 5,
  пятницу: 5,
  суббота: 6,
  воскресенье: 7,
  пн: 1,
  вт: 2,
  ср: 3,
  чт: 4,
  пт: 5,
  сб: 6,
  вс: 7,
};

function detectDay(text: string): WeekDayIndex | null {
  const t = text.toLowerCase().trim();
  for (const key of Object.keys(DAY_LOOKUP)) {
    if (t.includes(key)) return DAY_LOOKUP[key];
  }
  return null;
}

function parseTime(text: string): string | null {
  const m = text.match(/(\d{1,2}[:.]\d{2})\s*[-–—]\s*(\d{1,2}[:.]\d{2})/);
  if (m) return `${m[1].replace(".", ":")}-${m[2].replace(".", ":")}`;
  return null;
}

function cleanText(s: string): string {
  return s.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Parse a schedule result HTML into two weeks of structured data.
 * Best-effort: handles the common ISUCT table layouts; returns null if nothing
 * structured is found (caller falls back to sample data).
 */
export function parseScheduleHtml(
  html: string,
  type: ScheduleType,
  queryName: string,
  queryId: string,
  semesterStart: string,
): FullSchedule | null {
  try {
    const $ = cheerio.load(html);
    // restrict to the schedule region if present
    const root =
      $("#form-ajax-node-content").html() ||
      $(".region-content").html() ||
      $("body").html() ||
      html;

    const $root = cheerio.load(`<div id="root">${root}</div>`);
    const tables = $root("table");
    if (!tables.length) return null;

    const weeks: Record<WeekParity, { parity: WeekParity; days: DaySchedule[] }> = {
      I: {
        parity: "I",
        days: [1, 2, 3, 4, 5, 6, 7].map((d) => ({
          day: d as WeekDayIndex,
          lessons: [],
        })),
      },
      II: {
        parity: "II",
        days: [1, 2, 3, 4, 5, 6, 7].map((d) => ({
          day: d as WeekDayIndex,
          lessons: [],
        })),
      },
    };

    let currentParity: WeekParity = "I";
    const headings = $root("h1, h2, h3, h4, h5, strong, b, .schedule-week");
    headings.each((_, el) => {
      const txt = cleanText($root(el).text());
      if (/II\s*недел/i.test(txt)) currentParity = "II";
      else if (/I\s*недел/i.test(txt) && !/II/i.test(txt)) currentParity = "I";
      else if (/неч[её]тн/i.test(txt)) currentParity = "I";
      else if (/ч[её]тн/i.test(txt)) currentParity = "II";
    });

    // Layout A: rows = time slots, columns = days (header row has day names)
    tables.each((_, table) => {
      const $table = $root(table);
      const headerCells = $table.find("tr").first().find("th, td");
      const dayColumns: (WeekDayIndex | null)[] = [];
      headerCells.each((_, cell) => {
        const t = cleanText($root(cell).text());
        dayColumns.push(detectDay(t));
      });
      // If header didn't carry days, try first column rows naming the day.
      const rows = $table.find("tr").slice(1);
      if (dayColumns.some((d) => d !== null)) {
        rows.each((_, row) => {
          const cells = $root(row).find("td");
          cells.each((ci, cell) => {
            const day = dayColumns[ci];
            if (!day) return;
            const lesson = parseLessonCell($root, cell);
            if (lesson) weeks[currentParity].days[day - 1].lessons.push(lesson);
          });
        });
      } else {
        // Layout B: each row = one lesson, first cell = day, second = time
        let lastDay: WeekDayIndex | null = null;
        rows.each((_, row) => {
          const cells = $root(row).find("td, th");
          const cellsArr = cells.toArray();
          if (!cellsArr.length) return;
          const firstTxt = cleanText($root(cellsArr[0]).text());
          const day = detectDay(firstTxt) ?? lastDay;
          if (day) lastDay = day;
          if (!day) return;
          const timeTxt =
            cellsArr.length > 1
              ? cleanText($root(cellsArr[1]).text())
              : firstTxt;
          const time = parseTime(timeTxt) || parseTime(firstTxt);
          if (!time) return;
          const subjectCell =
            cellsArr.length > 2 ? $root(cellsArr[2]) : $root(cellsArr[1]);
          const lesson = parseLessonCell($root, subjectCell[0] as cheerio.AnyNode);
          if (lesson) {
            lesson.time = time;
            weeks[currentParity].days[day - 1].lessons.push(lesson);
          }
        });
      }
    });

    // Detect explicit "current week" marker if present.
    const bodyText = cleanText($root("body").text() || $root.text());
    const curMatch = bodyText.match(/текущ[а-яё]*\s*недел[яюе][^\n]*?(I{1,2}|неч[её]тн|ч[её]тн)/i);
    if (curMatch) {
      if (/II/i.test(curMatch[1]) || /ч[её]тн/i.test(curMatch[1]))
        currentParity = "II";
      else currentParity = "I";
    }

    const hasAny = weeks.I.days.some((d) => d.lessons.length) ||
      weeks.II.days.some((d) => d.lessons.length);
    if (!hasAny) return null;

    const computed = computeCurrentParity(semesterStart, "II");
    return {
      type,
      queryName,
      queryId,
      weeks,
      currentParity: computed,
      semesterStart,
      fetchedAt: new Date().toISOString(),
      source: "live",
    };
  } catch {
    return null;
  }
}

function parseLessonCell(
  $: cheerio.CheerioAPI,
  cell: cheerio.AnyNode,
): Lesson | null {
  const $cell = $(cell);
  const html = $cell.html() || "";
  const text = cleanText($cell.text());
  if (!text || text.length < 2) return null;
  // Split by <br> into lines for structured extraction.
  const lines = html
    .split(/<br\s*\/?>/i)
    .map((l) => cleanText($(l).text()))
    .filter(Boolean);
  const subject = lines[0] || text.split(/[,;]/)[0] || text;
  const lesson: Lesson = { time: "", subject: subject.replace(/\s+/g, " ").trim() };
  if (!lesson.subject) return null;
  for (let i = 1; i < lines.length; i++) {
    const ln = lines[i];
    if (/лек/i.test(ln)) lesson.type = "лек";
    else if (/прак/i.test(ln)) lesson.type = "прак";
    else if (/лаб/i.test(ln)) lesson.type = "лаб";
    else if (/зач/i.test(ln)) lesson.type = "зач";
    else if (/экз/i.test(ln)) lesson.type = "экз";
    const place = ln.match(/([А-ЯA-Z]{1,3}[-]?\d{1,4}[А-ЯA-Z]?|ауд\.?\s*\S+)/i);
    if (place) lesson.place = place[1];
    if (/подгрупп/i.test(ln)) {
      const sg = ln.match(/([12])\s*подгруп/i);
      if (sg) lesson.subgroup = `${sg[1]} п/г`;
    }
    if (/нед/i.test(ln)) lesson.weeks = ln;
    if (/препод/i.test(ln) || /^[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.[А-ЯЁ]\.?/.test(ln)) {
      const tm = ln.match(/([А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.[А-ЯЁ]\.?)\s*$/);
      if (tm) lesson.teacher = tm[1];
    }
    if (/групп/i.test(ln)) {
      const gm = ln.match(/([0-9А-ЯA-Z/]{2,8})/);
      if (gm) lesson.group = gm[1];
    }
  }
  // fallback time parse from text
  if (!lesson.time) {
    const t = parseTime(text);
    if (t) lesson.time = t;
  }
  return lesson;
}

/**
 * Fetch a schedule from isuct.ru by submitting the studschedule_form.
 * Returns null on any failure (network, parse) so the store can fall back.
 */
export async function fetchLiveSchedule(
  type: ScheduleType,
  id: string,
  name: string,
  semesterStart = "2025-09-02",
): Promise<FullSchedule | null> {
  try {
    const ctx = await getFormContext();
    if (!ctx) return null;
    const body = new URLSearchParams({
      type: TYPE_FIELD[type],
      [TEXT_FIELD[type]]: name,
      [ID_FIELD[type]]: id,
      form_build_id: ctx.buildId,
      form_id: "studschedule_form",
      op: "Показать расписание",
    });
    const { signal, clear } = withTimeout(7000);
    const res = await fetch(SCHEDULE_BASE_URL, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "ru-RU,ru;q=0.9",
        Cookie: ctx.cookie,
        Referer: SCHEDULE_BASE_URL,
        Origin: "https://www.isuct.ru",
      },
      body: body.toString(),
      signal,
      redirect: "follow",
    });
    clear();
    if (!res.ok) {
      recordFailure();
      return null;
    }
    const html = await res.text();
    const parsed = parseScheduleHtml(html, type, name, id, semesterStart);
    if (!parsed) recordFailure();
    return parsed;
  } catch {
    recordFailure();
    return null;
  }
}

// ─── Validation ─────────────────────────────────────────────────

/** Validate that a group/teacher/auditorium name matches the expected format.
 *  Returns an error message if invalid, null if valid. */
export function validateQuery(type: ScheduleType, query: string): string | null {
  const q = query.trim();
  if (!q) return "Введите текст для поиска";

  if (type === "group") {
    if (q.length < 2) {
      return "Номер группы слишком короткий. Пример: 2/25, ХТ-21";
    }
  } else if (type === "teacher") {
    if (q.length < 3) {
      return "Введите фамилию преподавателя (минимум 3 символа). Пример: Смирнов";
    }
  } else if (type === "auditorium") {
    if (q.length < 2) {
      return "Введите номер аудитории (минимум 2 символа). Пример: Г203";
    }
  }

  return null;
}
