// ISUCT schedule domain types — shared by scraper, sample data, bot engine, and API.

export type ScheduleType = "group" | "teacher" | "auditorium";

export interface SearchEntry {
  /** Numeric id returned by the isuct.ru autocomplete (idgrid / idprepid / idaudid). */
  id: string;
  /** Display name, e.g. "2/25" or "Смирнов А.А." */
  name: string;
}

export type WeekParity = "I" | "II";

/** 1 = Пн ... 7 = Вс */
export type WeekDayIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Lesson {
  time: string; // "08:30-10:05"
  subject: string; // "Математика"
  type?: string; // "лек" | "прак" | "лаб" | "зач" | "экз"
  teacher?: string; // teacher for a group schedule
  group?: string; // group for a teacher schedule
  place?: string; // аудитория, e.g. "Г203"
  subgroup?: string; // "1 п/г" | "2 п/г" | "" (all)
  weeks?: string; // "I нед" | "II нед" | "1-16 нед" | ""
  note?: string;
}

export interface DaySchedule {
  day: WeekDayIndex;
  lessons: Lesson[];
}

export interface WeekSchedule {
  parity: WeekParity;
  days: DaySchedule[]; // length 7 (Пн..Вс); lessons may be empty
}

export interface FullSchedule {
  type: ScheduleType;
  queryName: string; // "2/25" or "Смирнов А.А."
  queryId: string;
  weeks: Record<WeekParity, WeekSchedule>;
  /** Parity of the *current* week. */
  currentParity: WeekParity;
  /** ISO date of the semester anchor (parity reference). */
  semesterStart: string;
  fetchedAt: string;
  source: "live" | "sample";
  liveError?: string;
}

export const DAY_NAMES_SHORT: Record<WeekDayIndex, string> = {
  1: "Пн",
  2: "Вт",
  3: "Ср",
  4: "Чт",
  5: "Пт",
  6: "Сб",
  7: "Вс",
};

export const DAY_NAMES_FULL: Record<WeekDayIndex, string> = {
  1: "Понедельник",
  2: "Вторник",
  3: "Среда",
  4: "Четверг",
  5: "Пятница",
  6: "Суббота",
  7: "Воскресенье",
};

export const LESSON_TYPE_LABELS: Record<string, string> = {
  лек: "Лекция",
  прак: "Практика",
  лаб: "Лабораторная",
  зач: "Зачёт",
  экз: "Экзамен",
  кр: "Курсовая",
};

export const SCHEDULE_BASE_URL = "https://www.isuct.ru/student/schedule";
