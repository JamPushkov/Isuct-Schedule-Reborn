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
import { SCHEDULE_BASE_URL } from "./types";

const ISUCT_ORIGIN = "https://www.isuct.ru";
const AJAX_URL = `${ISUCT_ORIGIN}/system/ajax`;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Safari/537.36";

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

function withTimeout(ms: number) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, ms);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

// ─────────────────────────────────────────────────────────────
// Circuit breaker
// ─────────────────────────────────────────────────────────────

const CB_OPEN_MS = 30_000;

let cbLastFailure = 0;
let cbProbeInflight = false;

function circuitOpen(): boolean {
  if (cbProbeInflight) return false;

  return Date.now() - cbLastFailure < CB_OPEN_MS;
}

function recordFailure() {
  cbLastFailure = Date.now();
}

function recordSuccess() {
  cbLastFailure = 0;
}

function startProbe() {
  cbProbeInflight = true;
}

function endProbe() {
  cbProbeInflight = false;
}

// ─────────────────────────────────────────────────────────────
// HTTP session / form context
// ─────────────────────────────────────────────────────────────

interface FormContext {
  buildId: string;
  cookie: string;
}

/**
 * Extract Set-Cookie headers in a way that works on Node/Vercel
 * as well as possible without requiring a special cookie library.
 */
function extractCookies(headers: Headers): string {
  const anyHeaders = headers as Headers & {
    getSetCookie?: () => string[];
  };

  const setCookies =
    typeof anyHeaders.getSetCookie === "function"
      ? anyHeaders.getSetCookie()
      : [];

  if (setCookies.length > 0) {
    return setCookies
      .map((cookie) => cookie.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");
  }

  const single = headers.get("set-cookie");

  if (!single) {
    return "";
  }

  /*
   * Fallback for environments where getSetCookie() is unavailable.
   * We mainly need the first cookie pair(s), not cookie attributes.
   */
  return single
    .split(/,(?=[^;,]+=)/)
    .map((cookie) => cookie.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

/**
 * GET /student/schedule
 *
 * We need:
 *   - fresh form_build_id
 *   - cookies from the same HTTP session
 */
export async function getFormContext(): Promise<FormContext | null> {
  if (circuitOpen()) {
    return null;
  }

  startProbe();

  try {
    const { signal, clear } = withTimeout(30_000);

    const response = await fetch(SCHEDULE_BASE_URL, {
      method: "GET",
      redirect: "follow",
      signal,

      headers: {
        "User-Agent": UA,
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
      },
    });

    clear();

    if (!response.ok) {
      console.error(
        `[ISUCT] GET schedule page failed: ${response.status} ${response.statusText}`,
      );

      recordFailure();
      return null;
    }

    const html = await response.text();
    const cookie = extractCookies(response.headers);

    const $ = cheerio.load(html);

    const buildId =
      $('input[name="form_build_id"]').attr("value") ||
      html.match(
        /name=["']form_build_id["'][^>]*value=["']([^"']+)["']/i,
      )?.[1] ||
      "";

    if (!buildId) {
      console.error("[ISUCT] form_build_id was not found");

      recordFailure();
      return null;
    }

    console.log(
      `[ISUCT] form context received: buildId=${buildId}, cookie=${cookie ? "yes" : "no"}`,
    );

    recordSuccess();

    return {
      buildId,
      cookie,
    };
  } catch (error) {
    console.error("[ISUCT] getFormContext error:", error);

    recordFailure();
    return null;
  } finally {
    endProbe();
  }
}

// ─────────────────────────────────────────────────────────────
// Autocomplete
// ─────────────────────────────────────────────────────────────

function parseAutocomplete(json: string): SearchEntry[] {
  const result: SearchEntry[] = [];

  try {
    const data = JSON.parse(json);

    if (Array.isArray(data)) {
      for (const item of data) {
        if (typeof item === "string") {
          const value = item.trim();

          if (value) {
            result.push({
              id: value,
              name: value,
            });
          }

          continue;
        }

        if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;

          const rawLabel = String(
            obj.label ??
              obj.value ??
              obj.name ??
              "",
          ).trim();

          const rawValue = String(
            obj.value ??
              obj.id ??
              "",
          ).trim();

          if (!rawLabel) continue;

          /*
           * Possible autocomplete formats:
           *
           *   { label, value, id }
           *   "2/278 [22852]"
           *   "2/278|22852"
           */
          const pipe = rawLabel.match(/^(.+?)\s*\|\s*(\d+)$/);

          if (pipe) {
            result.push({
              id: pipe[2],
              name: pipe[1].trim(),
            });

            continue;
          }

          const bracket =
            rawValue.match(/^\[?id[:\s]*(\d+)\]?$/i) ||
            rawLabel.match(/\[id[:\s]*(\d+)\]/i) ||
            rawLabel.match(/\[(\d+)\]/);

          const id = bracket?.[1] ?? rawValue;

          result.push({
            id,
            name: rawLabel.replace(/\s*\[.*?\]\s*$/, "").trim(),
          });
        }
      }
    } else if (
      data &&
      typeof data === "object"
    ) {
      for (const [id, name] of Object.entries(data)) {
        result.push({
          id: String(id),
          name: String(name).trim(),
        });
      }
    }
  } catch (error) {
    console.error("[ISUCT] autocomplete JSON parse failed:", error);
  }

  return result;
}

export async function searchLive(
  type: ScheduleType,
  query: string,
): Promise<SearchEntry[]> {
  const q = query.trim();

  if (!q || circuitOpen()) {
    return [];
  }

  startProbe();

  try {
    const endpoint =
      `${ISUCT_ORIGIN}/student/schedule/` +
      `${AUTOCOMPLETE_PATH[type]}/` +
      encodeURIComponent(q);

    const { signal, clear } = withTimeout(15_000);

    const response = await fetch(endpoint, {
      method: "GET",
      redirect: "follow",
      signal,

      headers: {
        "User-Agent": UA,
        "Accept":
          "application/json, text/javascript, */*; q=0.01",
        "Accept-Language":
          "ru-RU,ru;q=0.9,en;q=0.8",
        "X-Requested-With":
          "XMLHttpRequest",
        "Referer":
          SCHEDULE_BASE_URL,
      },
    });

    clear();

    if (!response.ok) {
      console.error(
        `[ISUCT] autocomplete failed: ${response.status}`,
      );

      recordFailure();
      return [];
    }

    const text = await response.text();
    const parsed = parseAutocomplete(text);

    if (parsed.length > 0) {
      recordSuccess();
    }

    return parsed;
  } catch (error) {
    console.error("[ISUCT] searchLive error:", error);

    recordFailure();

    return [];
  } finally {
    endProbe();
  }
}

// ─────────────────────────────────────────────────────────────
// Week parity
// ─────────────────────────────────────────────────────────────

export function computeCurrentParity(
  semesterStartISO: string,
  startParity: WeekParity = "I",
  now: Date = new Date(),
): WeekParity {
  const start = new Date(`${semesterStartISO}T00:00:00`);

  if (Number.isNaN(start.getTime())) {
    return startParity;
  }

  const startMonday = new Date(start);
  startMonday.setHours(0, 0, 0, 0);

  startMonday.setDate(
    startMonday.getDate() -
      ((startMonday.getDay() + 6) % 7),
  );

  const currentMonday = new Date(now);
  currentMonday.setHours(0, 0, 0, 0);

  currentMonday.setDate(
    currentMonday.getDate() -
      ((currentMonday.getDay() + 6) % 7),
  );

  const diffMs =
    currentMonday.getTime() -
    startMonday.getTime();

  const weeks = Math.floor(
    diffMs / (7 * 24 * 60 * 60 * 1000),
  );

  if (weeks < 0) {
    return startParity;
  }

  return weeks % 2 === 0
    ? startParity
    : startParity === "I"
      ? "II"
      : "I";
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function cleanText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectDay(value: string): WeekDayIndex | null {
  const text = cleanText(value).toLowerCase();

  for (const [name, day] of Object.entries(DAY_LOOKUP)) {
    if (text.includes(name)) {
      return day;
    }
  }

  return null;
}

function parseTime(value: string): string | null {
  const match = value.match(
    /(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})/,
  );

  if (!match) {
    return null;
  }

  const startH = match[1].padStart(2, "0");
  const startM = match[2];

  const endH = match[3].padStart(2, "0");
  const endM = match[4];

  return `${startH}:${startM}-${endH}:${endM}`;
}

function emptyWeek(parity: WeekParity) {
  return {
    parity,
    days: [1, 2, 3, 4, 5, 6, 7].map(
      (day) => ({
        day: day as WeekDayIndex,
        lessons: [],
      }),
    ),
  };
}

function decodeHtmlEntities(value: string): string {
  const $ = cheerio.load(`<span>${value}</span>`, {
    decodeEntities: true,
  });

  return cleanText($("span").text());
}

function detectLessonType(
  text: string,
): Lesson["type"] | undefined {
  const value = text.toLowerCase();

  if (/\bлаб\.?|\bлаб\b|\bлаборатор/.test(value)) {
    return "лаб";
  }

  if (/\bлек\.?|\bлек\b|\bлекция/.test(value)) {
    return "лек";
  }

  if (/\bпр\.\s*з\.?|\bпракти/.test(value)) {
    return "прак";
  }

  if (/\bзач/.test(value)) {
    return "зач";
  }

  if (/\bэкз/.test(value)) {
    return "экз";
  }

  if (/\bкурсов/.test(value)) {
    return "кр";
  }

  return undefined;
}

function extractTeacher(text: string): string | undefined {
  /*
   * Examples from the real ISUCT response:
   *
   * Нестеренко А.С.
   * Марчук Н.А.
   * Некрасова В.Н.
   * Кулакова С.В.
   *
   * We intentionally search everywhere, not only at end of line.
   */
  const match = text.match(
    /\b[А-ЯЁ][а-яё-]+\s+[А-ЯЁ]\.[А-ЯЁ]\.?\b/u,
  );

  return match?.[0];
}

function extractPlace(text: string): string | undefined {
  /*
   * Examples:
   * Л309
   * Л201
   * К205
   * К103
   * К307
   * А26
   * спортзал
   */
  const match = text.match(
    /\b(?:[А-ЯЁA-Z]{1,3}\s*[-]?\s*\d{1,4}[А-ЯЁA-Z]?|спортзал)\b/u,
  );

  return match?.[0]?.replace(/\s+/g, "");
}

function extractDateRange(
  text: string,
): { from?: string; to?: string } {
  const match = text.match(
    /с\s+(\d{2}\.\d{2}\.\d{4})\s+по\s+(\d{2}\.\d{2}\.\d{4})/i,
  );

  if (!match) {
    return {};
  }

  return {
    from: match[1],
    to: match[2],
  };
}

function extractSubgroup(
  text: string,
): string | undefined {
  const match =
    text.match(/([12])\s*п\/г/i) ||
    text.match(/([12])\s*подгруп/i);

  if (!match) {
    return undefined;
  }

  return `${match[1]} п/г`;
}

/**
 * The actual schedule cell looks like:
 *
 *   Технология программирования Нестеренко А.С. лаб. Л309
 *   с 09.09.2026 по 30.12.2026
 *
 * or:
 *
 *   Основы военной подготовки ... Куранова Н.Н. лк. В201
 *   с 07.09.2026 по 28.12.2026
 */
function parseLessonCell(
  $: cheerio.CheerioAPI,
  cell: cheerio.AnyNode,
  time: string,
): Lesson | null {
  const $cell = $(cell);

  const rawHtml = $cell.html() || "";
  const fullText = cleanText($cell.text());

  if (
    !fullText ||
    fullText === "-" ||
    fullText === "—"
  ) {
    return null;
  }

  const lines = rawHtml
    .split(/<br\s*\/?>/gi)
    .map((line) => {
      const fragment = cheerio.load(
        `<div>${line}</div>`,
        { decodeEntities: true },
      );

      return cleanText(
        fragment("div").text(),
      );
    })
    .filter(Boolean);

  const mainText = cleanText(
    lines[0] || fullText,
  );

  if (!mainText || mainText === "&nbsp;") {
    return null;
  }

  const lesson: Lesson = {
    time,
    subject: mainText,
  };

  const combined = cleanText(
    lines.join(" "),
  );

  lesson.type = detectLessonType(combined);

  const teacher = extractTeacher(mainText);
  if (teacher) {
    lesson.teacher = teacher;
  }

  const place =
    extractPlace(mainText) ||
    extractPlace(combined);

  if (place) {
    lesson.place = place;
  }

  const subgroup = extractSubgroup(combined);
  if (subgroup) {
    lesson.subgroup = subgroup;
  }

  const dates = extractDateRange(combined);

  if (dates.from && dates.to) {
    lesson.weeks =
      `с ${dates.from} по ${dates.to}`;
  }

  /*
   * Keep the subject clean.
   *
   * We remove teacher + type + room from the end where possible,
   * while leaving the real subject intact.
   */
  let subject = mainText;

  if (teacher) {
    subject = subject.replace(teacher, " ");
  }

  if (lesson.type) {
    const typePatterns = [
      /\bлаб\.?\b/gi,
      /\bлек\.?\b/gi,
      /\bлк\.?\b/gi,
      /\bпр\.\s*з\.?\b/gi,
      /\bпрак\.?\b/gi,
    ];

    for (const pattern of typePatterns) {
      subject = subject.replace(pattern, " ");
    }
  }

  if (place) {
    subject = subject.replace(
      new RegExp(
        `\\b${place.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        "giu",
      ),
      " ",
    );
  }

  subject = cleanText(subject);

  if (subject.length >= 2) {
    lesson.subject = subject;
  }

  /*
   * For cases where the date range is the only clue about
   * which half of the semester the lesson belongs to, keep
   * the range in lesson.weeks. The two-week table structure
   * itself is authoritative for I / II.
   */
  return lesson.subject ? lesson : null;
}

function isEmptyCell(
  $: cheerio.CheerioAPI,
  cell: cheerio.AnyNode,
): boolean {
  const text = cleanText($(cell).text());

  return (
    !text ||
    text === "-" ||
    text === "—" ||
    text === "\u00a0"
  );
}

// ─────────────────────────────────────────────────────────────
// Real ISUCT table parser
// ─────────────────────────────────────────────────────────────

/**
 * Parses the actual ISUCT schedule table:
 *
 * header row 1:
 *   нед | Время | Занятия
 *
 * header row 2:
 *   Понедельник | Вторник | ...
 *
 * data:
 *   1 | 08:00-09:35 | day1 | day2 | ... | day6
 *     | 09:50-11:25 | day1 | ...
 *     | ...
 *   2 | 08:00-09:35 | ...
 *
 * The first column has rowspan and therefore is NOT present
 * in every following row.
 */
function parseIsuctScheduleTable(
  $: cheerio.CheerioAPI,
  $table: cheerio.Cheerio<table>,
  type: ScheduleType,
  queryName: string,
  queryId: string,
  semesterStart: string,
): FullSchedule | null {
  const weeks: Record<WeekParity, ReturnType<typeof emptyWeek>> = {
    I: emptyWeek("I"),
    II: emptyWeek("II"),
  };

  const rows = $table.find("tr").toArray();

  if (rows.length < 3) {
    return null;
  }

  // ---------------------------------------------------------
  // Find the header containing Monday...Saturday
  // ---------------------------------------------------------

  let headerRowIndex = -1;

  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const $row = $(rows[i]);

    const rowText = cleanText(
      $row.text(),
    ).toLowerCase();

    if (
      rowText.includes("понедельник") ||
      rowText.includes("вторник") ||
      rowText.includes("среда")
    ) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex < 0) {
    return null;
  }

  const dayColumns: WeekDayIndex[] = [];

  const $header = $(rows[headerRowIndex]);

  $header
    .find("th, td")
    .each((_, cell) => {
      const day = detectDay(
        cleanText($(cell).text()),
      );

      if (day) {
        dayColumns.push(day);
      }
    });

  if (dayColumns.length < 5) {
    return null;
  }

  // ---------------------------------------------------------
  // Parse rows after day header
  // ---------------------------------------------------------

  let currentWeek: WeekParity = "I";

  let currentWeekNumber = 1;

  let currentTime = "";

  for (
    let rowIndex = headerRowIndex + 1;
    rowIndex < rows.length;
    rowIndex++
  ) {
    const $row = $(rows[rowIndex]);
    const cells = $row.find("td, th").toArray();

    if (!cells.length) {
      continue;
    }

    const firstText = cleanText(
      $(cells[0]).text(),
    );

    /*
     * Week number cells use rowspan="4":
     *
     * 1
     * 2
     *
     * So when we see "1" or "2" in the first
     * cell and it is actually a row-spanning week marker,
     * switch parity.
     */
    const rowSpan =
      $(cells[0]).attr("rowspan");

    const numericWeek = /^\d+$/.test(firstText)
      ? Number(firstText)
      : null;

    if (
      numericWeek !== null &&
      numericWeek >= 1 &&
      numericWeek <= 2 &&
      rowSpan
    ) {
      currentWeekNumber = numericWeek;
      currentWeek =
        numericWeek % 2 === 0
          ? "II"
          : "I";
    }

    /*
     * Determine where the time cell is.
     *
     * For first row of a week:
     *   [week] [time] [mon] ... [sat]
     *
     * For following rows:
     *   [time] [mon] ... [sat]
     */
    let timeIndex = 0;

    const possibleTimeWithWeek =
      parseTime(
        cleanText($(cells[1]).text()),
      );

    const possibleTimeWithoutWeek =
      parseTime(
        cleanText($(cells[0]).text()),
      );

    if (possibleTimeWithWeek) {
      timeIndex = 1;
      currentTime = possibleTimeWithWeek;
    } else if (possibleTimeWithoutWeek) {
      timeIndex = 0;
      currentTime = possibleTimeWithoutWeek;
    } else {
      /*
       * This can happen on malformed/merged rows.
       * Skip instead of associating the lesson with
       * the wrong time.
       */
      continue;
    }

    const lessonStartIndex = timeIndex + 1;

    for (
      let dayOffset = 0;
      dayOffset < dayColumns.length;
      dayOffset++
    ) {
      const cellIndex =
        lessonStartIndex + dayOffset;

      const cell = cells[cellIndex];

      if (!cell) {
        continue;
      }

      if (isEmptyCell($, cell)) {
        continue;
      }

      const day = dayColumns[dayOffset];

      const lesson = parseLessonCell(
        $,
        cell,
        currentTime,
      );

      if (!lesson) {
        continue;
      }

      weeks[currentWeek]
        .days[day - 1]
        .lessons
        .push(lesson);
    }
  }

  const hasFirstWeek = weeks.I.days.some(
    (day) => day.lessons.length > 0,
  );

  const hasSecondWeek = weeks.II.days.some(
    (day) => day.lessons.length > 0,
  );

  if (!hasFirstWeek && !hasSecondWeek) {
    return null;
  }

  return {
    type,
    queryName,
    queryId,

    weeks,

    currentParity:
      computeCurrentParity(
        semesterStart,
        "I",
      ),

    semesterStart,

    fetchedAt:
      new Date().toISOString(),

    source: "live",
  };
}

/**
 * Public HTML parser.
 *
 * It accepts:
 *   - raw schedule HTML
 *   - Drupal command.data
 *   - a larger wrapper containing the schedule
 */
export function parseScheduleHtml(
  html: string,
  type: ScheduleType,
  queryName: string,
  queryId: string,
  semesterStart: string,
): FullSchedule | null {
  try {
    const $ = cheerio.load(
      decodeHtmlEntities(html),
      {
        decodeEntities: true,
      },
    );

    let bestSchedule: FullSchedule | null = null;

    $("table.schedule").each((_, element) => {
      const parsed = parseIsuctScheduleTable(
        $,
        $(element),
        type,
        queryName,
        queryId,
        semesterStart,
      );

      if (parsed) {
        bestSchedule = parsed;
      }
    });

    if (bestSchedule) {
      return bestSchedule;
    }

    /*
     * Fallback for a possible future server-side markup change.
     */
    $("table").each((_, element) => {
      if (bestSchedule) return;

      const tableText = cleanText(
        $(element).text(),
      ).toLowerCase();

      const looksLikeSchedule =
        tableText.includes("понедельник") &&
        /\d{1,2}:\d{2}/.test(tableText);

      if (!looksLikeSchedule) {
        return;
      }

      const parsed = parseIsuctScheduleTable(
        $,
        $(element),
        type,
        queryName,
        queryId,
        semesterStart,
      );

      if (parsed) {
        bestSchedule = parsed;
      }
    });

    return bestSchedule;
  } catch (error) {
    console.error(
      "[ISUCT] parseScheduleHtml error:",
      error,
    );

    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Drupal AJAX response
// ─────────────────────────────────────────────────────────────

interface DrupalAjaxCommand {
  command?: string;
  method?: string | null;
  selector?: string | null;
  data?: string | null;
  settings?: unknown;
}

function extractScheduleHtmlFromAjax(
  responseText: string,
): {
  html: string;
  pdfUrl?: string;
} | null {
  try {
    const commands =
      JSON.parse(
        responseText,
      ) as DrupalAjaxCommand[];

    if (!Array.isArray(commands)) {
      return null;
    }

    let html = "";
    let pdfUrl: string | undefined;

    for (const command of commands) {
      if (
        command.command === "insert" &&
        typeof command.data === "string" &&
        command.data.includes(
          '<table class="schedule"',
        )
      ) {
        html += command.data;

        const pdfMatch =
          command.data.match(
            /href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/i,
          );

        if (pdfMatch) {
          pdfUrl = pdfMatch[1];
        }
      }
    }

    if (!html) {
      return null;
    }

    return {
      html,
      pdfUrl,
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Live schedule fetch
// ─────────────────────────────────────────────────────────────

export async function fetchLiveSchedule(
  type: ScheduleType,
  id: string,
  name: string,
  semesterStart = "2026-09-07",
): Promise<FullSchedule | null> {
  if (circuitOpen()) {
    return null;
  }

  try {
    const context = await getFormContext();

    if (!context) {
      return null;
    }

    /*
     * For the real Drupal form:
     *
     * group:
     *   type=currentstudentsgroups
     *   idgr=2/278
     *   idgrid=22852
     *
     * teacher:
     *   type=prepod
     *   idprep=...
     *   idprepid=...
     *
     * auditorium:
     *   type=auditorium
     *   idaud=...
     *   idaudid=...
     */
    const body = new URLSearchParams();

    body.set(
      "type",
      TYPE_FIELD[type],
    );

    body.set(
      "idaud",
      type === "auditorium"
        ? name
        : "",
    );

    body.set(
      "idprep",
      type === "teacher"
        ? name
        : "",
    );

    body.set(
      "idgr",
      type === "group"
        ? name
        : "",
    );

    body.set(
      "idprepid",
      type === "teacher"
        ? id
        : "",
    );

    body.set(
      "idaudid",
      type === "auditorium"
        ? id
        : "",
    );

    body.set(
      "idgrid",
      type === "group"
        ? id
        : "",
    );

    body.set(
      "form_build_id",
      context.buildId,
    );

    body.set(
      "form_id",
      "studschedule_form",
    );

    /*
     * This is important.
     * The browser sends these Drupal AJAX triggering fields.
     */
    body.set(
      "_triggering_element_name",
      "op",
    );

    body.set(
      "_triggering_element_value",
      "Показать расписание",
    );

    const { signal, clear } =
      withTimeout(30_000);

    const response =
      await fetch(AJAX_URL, {
        method: "POST",
        redirect: "follow",
        signal,

        headers: {
          "User-Agent": UA,

          "Accept":
            "application/json, text/javascript, */*; q=0.01",

          "Accept-Language":
            "ru-RU,ru;q=0.9,en;q=0.8",

          "Content-Type":
            "application/x-www-form-urlencoded; charset=UTF-8",

          "X-Requested-With":
            "XMLHttpRequest",

          "Origin":
            ISUCT_ORIGIN,

          "Referer":
            SCHEDULE_BASE_URL,

          ...(context.cookie
            ? {
                Cookie:
                  context.cookie,
              }
            : {}),
        },

        body:
          body.toString(),
      });

    clear();

    if (!response.ok) {
      console.error(
        `[ISUCT] /system/ajax failed: ${response.status} ${response.statusText}`,
      );

      recordFailure();
      return null;
    }

    const contentType =
      response.headers.get(
        "content-type",
      ) || "";

    const responseText =
      await response.text();

    console.log(
      `[ISUCT] AJAX response: status=${response.status}, content-type=${contentType}, bytes=${responseText.length}`,
    );

    const extracted =
      extractScheduleHtmlFromAjax(
        responseText,
      );

    if (!extracted) {
      console.error(
        "[ISUCT] Schedule HTML was not found in Drupal AJAX response",
      );

      console.error(
        responseText.slice(0, 3000),
      );

      recordFailure();
      return null;
    }

    const parsed =
      parseScheduleHtml(
        extracted.html,
        type,
        name,
        id,
        semesterStart,
      );

    if (!parsed) {
      console.error(
        "[ISUCT] Schedule HTML found, but parser returned null",
      );

      recordFailure();
      return null;
    }

    /*
     * Optional debug information.
     */
    if (extracted.pdfUrl) {
      console.log(
        `[ISUCT] PDF: ${extracted.pdfUrl}`,
      );
    }

    const totalLessons =
      parsed.weeks.I.days.reduce(
        (sum, day) =>
          sum + day.lessons.length,
        0,
      ) +
      parsed.weeks.II.days.reduce(
        (sum, day) =>
          sum + day.lessons.length,
        0,
      );

    console.log(
      `[ISUCT] Parsed ${totalLessons} lessons for ${name}`,
    );

    recordSuccess();

    return parsed;
  } catch (error) {
    console.error(
      "[ISUCT] fetchLiveSchedule error:",
      error,
    );

    recordFailure();

    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────

export function validateQuery(
  type: ScheduleType,
  query: string,
): string | null {
  const value =
    query.trim();

  if (!value) {
    return "Введите текст для поиска";
  }

  if (type === "group") {
    if (value.length < 2) {
      return (
        "Номер группы слишком короткий. " +
        "Пример: 2/25"
      );
    }
  }

  if (type === "teacher") {
    if (value.length < 3) {
      return (
        "Введите фамилию преподавателя " +
        "(минимум 3 символа)."
      );
    }
  }

  if (type === "auditorium") {
    if (value.length < 2) {
      return (
        "Введите номер аудитории. " +
        "Пример: Г203"
      );
    }
  }

  return null;
}