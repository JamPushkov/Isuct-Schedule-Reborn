// Realistic ISUCT-style sample schedule data.
// Used for the interactive demo and as a graceful fallback when isuct.ru is
// unreachable from the host (e.g. sandbox). Data is generated deterministically
// from the query name so every group/teacher returns a stable, realistic schedule.

import type {
  DaySchedule,
  FullSchedule,
  Lesson,
  ScheduleType,
  WeekParity,
  WeekDayIndex,
} from "./types";
import { DAY_NAMES_FULL } from "./types";

/** Standard ISUCT class (пара) time slots. */
export const TIME_SLOTS = [
  "08:30-10:05",
  "10:15-11:50",
  "12:30-14:05",
  "14:15-15:50",
  "16:00-17:35",
  "17:45-19:20",
  "19:30-21:05",
];

const SUBJECTS = [
  { name: "Высшая математика", type: "лек" },
  { name: "Высшая математика", type: "прак" },
  { name: "Органическая химия", type: "лек" },
  { name: "Органическая химия", type: "лаб" },
  { name: "Неорганическая химия", type: "лек" },
  { name: "Неорганическая химия", type: "лаб" },
  { name: "Физическая химия", type: "лек" },
  { name: "Физическая химия", type: "прак" },
  { name: "Аналитическая химия", type: "лаб" },
  { name: "Физика", type: "лек" },
  { name: "Физика", type: "лаб" },
  { name: "Информатика", type: "лаб" },
  { name: "Информатика", type: "лек" },
  { name: "Иностранный язык", type: "прак" },
  { name: "Инженерная графика", type: "прак" },
  { name: "Теоретическая механика", type: "лек" },
  { name: "Теплотехника", type: "лек" },
  { name: "Процессы и аппараты", type: "лек" },
  { name: "Экономика", type: "лек" },
  { name: "Философия", type: "прак" },
  { name: "История России", type: "лек" },
  { name: "Экология", type: "лек" },
  { name: "БЖД", type: "прак" },
  { name: "Коллоидная химия", type: "лек" },
  { name: "Химическая технология", type: "лек" },
];

const TEACHERS = [
  "Смирнова Е.В.",
  "Иванов А.С.",
  "Кузнецов Д.А.",
  "Петрова О.Н.",
  "Соколов М.И.",
  "Морозова Л.П.",
  "Волков В.В.",
  "Зайцева Н.К.",
  "Орлов А.А.",
  "Никитина Т.С.",
  "Фёдоров Р.Г.",
  "Васильева А.М.",
];

const GROUPS = [
  "1/41",
  "1/42",
  "2/25",
  "2/26",
  "3/11",
  "3/12",
  "4/13",
  "ХТ-21",
  "ХТ-31",
  "ХБ-22",
];

const AUDITORIUMS = [
  "Г203",
  "Г205",
  "Г306",
  "Б301",
  "Б410",
  "А101",
  "А215",
  "ХЛ-1",
  "ХЛ-2",
  "420",
  "305",
  "112",
];

/** Deterministic 32-bit hash so the same query always yields the same schedule. */
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function makeLesson(
  rng: () => number,
  parity: WeekParity,
  type: ScheduleType,
  queryName: string,
  slotIdx: number,
): Lesson {
  const subj = pick(rng, SUBJECTS);
  const lesson: Lesson = {
    time: TIME_SLOTS[slotIdx],
    subject: subj.name,
    type: subj.type,
    place: pick(rng, AUDITORIUMS),
    weeks: parity === "I" ? "I нед" : "II нед",
  };
  if (type === "group") {
    lesson.teacher = pick(rng, TEACHERS);
    // some lessons split by subgroup
    if (subj.type === "лаб" && rng() > 0.5) {
      lesson.subgroup = rng() > 0.5 ? "1 п/г" : "2 п/г";
    }
  } else if (type === "teacher") {
    lesson.group = pick(rng, GROUPS);
  } else {
    lesson.group = pick(rng, GROUPS);
    lesson.teacher = pick(rng, TEACHERS);
  }
  return lesson;
}

function makeDay(
  rng: () => number,
  day: WeekDayIndex,
  parity: WeekParity,
  type: ScheduleType,
  queryName: string,
): DaySchedule {
  // Sunday usually free; weekdays 3-5 pairs; saturday 1-3
  let maxPairs = 4;
  if (day === 6) maxPairs = 3;
  if (day === 7) maxPairs = 0;
  const count = Math.floor(rng() * (maxPairs + 1));
  const lessons: Lesson[] = [];
  for (let i = 0; i < count; i++) {
    // occasional gap: skip a slot
    lessons.push(makeLesson(rng, parity, type, queryName, i));
  }
  return { day, lessons };
}

function makeWeek(
  seed: number,
  parity: WeekParity,
  type: ScheduleType,
  queryName: string,
) {
  const rng = mulberry32(seed + (parity === "I" ? 1 : 2));
  const days: DaySchedule[] = [];
  for (let d = 1; d <= 7; d++) {
    days.push(makeDay(rng, d as WeekDayIndex, parity, type, queryName));
  }
  return { parity, days };
}

/**
 * Build a deterministic, realistic schedule for any group / teacher / auditorium.
 */
export function generateSampleSchedule(
  type: ScheduleType,
  queryName: string,
  semesterStart: string,
  currentParity: WeekParity,
): FullSchedule {
  const seed = hash(`${type}:${queryName}`);
  const weeks = {
    I: makeWeek(seed, "I", type, queryName),
    II: makeWeek(seed ^ 0x9e3779b9, "II", type, queryName),
  };
  return {
    type,
    queryName,
    queryId: String(seed % 100000),
    weeks,
    currentParity,
    semesterStart,
    fetchedAt: new Date().toISOString(),
    source: "sample",
  };
}

/** Curated, fully hand-written entries for the demo search dropdown. */
export const SAMPLE_GROUPS = [
  "1/41",
  "1/42",
  "2/25",
  "2/26",
  "3/11",
  "3/12",
  "4/13",
  "ХТ-21",
  "ХТ-31",
  "ХБ-22",
];

export const SAMPLE_TEACHERS = [
  "Смирнова Е.В.",
  "Иванов А.С.",
  "Кузнецов Д.А.",
  "Петрова О.Н.",
  "Соколов М.И.",
  "Морозова Л.П.",
  "Волков В.В.",
  "Зайцева Н.К.",
];

/** Search the curated sample lists (used when live autocomplete is unavailable). */
export function searchSample(
  type: ScheduleType,
  query: string,
): { id: string; name: string }[] {
  const q = query.trim().toLowerCase();
  const list =
    type === "group"
      ? SAMPLE_GROUPS
      : type === "teacher"
        ? SAMPLE_TEACHERS
        : ["Г203", "Б301", "ХЛ-2"];
  return list
    .filter((n) => n.toLowerCase().includes(q))
    .slice(0, 12)
    .map((name, i) => ({ id: String(hash(name) % 100000), name }));
}

export { DAY_NAMES_FULL };
