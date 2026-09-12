"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Send,
  CheckCheck,
  MoreVertical,
  GraduationCap,
  Search,
  RotateCcw,
  History,
  Pin,
  Bookmark,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type { ScheduleType } from "@/lib/isuct/types";

interface InlineButton {
  text: string;
  callback_data: string;
}
interface SelectedEntity {
  type: ScheduleType;
  id: string;
  name: string;
}
interface Reply {
  chatId: string;
  text: string;
  keyboard: InlineButton[][];
  edit: boolean;
  state: string;
  type: ScheduleType | null;
  selected: SelectedEntity | null;
  reminder?: {
    lessonTime: string | null;
    subject: string | null;
    leadMinutes: number;
    message: string;
  } | null;
}
interface Msg {
  id: string;
  role: "bot" | "user";
  html: string;
  keyboard?: InlineButton[][];
  /** Detected dominant lesson type for color-coded left border. */
  lessonTint?: string | null;
}
interface SearchResult {
  id: string;
  name: string;
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ─── Lesson-type color tints ──────────────────────────────────────
// Maps lesson-type emoji → a tailwind left-border color class.
// The web demo uses these to give schedule bubbles a colored accent stripe.
const LESSON_TINTS: Record<string, string> = {
  "📖": "border-l-sky-400", // лекция
  "✏️": "border-l-amber-400", // практика
  "🧪": "border-l-emerald-400", // лабораторная
  "📋": "border-l-violet-400", // зачёт
  "📝": "border-l-rose-400", // экзамен
  "📄": "border-l-cyan-400", // курсовая
  "📘": "border-l-slate-300", // default
};

/**
 * Detect the dominant lesson-type emoji in a block of HTML by counting
 * occurrences of each known emoji and returning the most frequent one's
 * border color. Ties are broken by first appearance in the text so the
 * tint matches the first lesson when counts are equal.
 */
function detectTint(html: string): string | null {
  const emojis = Object.keys(LESSON_TINTS);
  const counts: Record<string, { count: number; firstIndex: number }> = {};
  for (const emoji of emojis) {
    let idx = 0;
    let count = 0;
    let firstIndex = -1;
    while ((idx = html.indexOf(emoji, idx)) !== -1) {
      if (firstIndex === -1) firstIndex = idx;
      count++;
      idx += emoji.length;
    }
    if (count > 0) counts[emoji] = { count, firstIndex };
  }
  const entries = Object.entries(counts);
  if (!entries.length) return null;
  entries.sort(
    (a, b) =>
      b[1].count - a[1].count || a[1].firstIndex - b[1].firstIndex,
  );
  return LESSON_TINTS[entries[0][0]];
}

/** Minimal, safe HTML sanitiser: allow only b/i/br, strip everything else. */
function safeHtml(input: string): string {
  // engine already escapes dynamic text; convert newlines to <br/>
  const withBr = input.replace(/\n/g, "<br/>");
  // allow <b>, </b>, <i>, </i>, <br/>, <br>; drop any other tag.
  return withBr.replace(/<(?!\/?(?:b|i|br)\b)[^>]*>/gi, "");
}

function getOrCreateChatId() {
  if (typeof window === "undefined") return "demo-" + uid();
  const k = "isuct_bot_chat_id";
  let v = localStorage.getItem(k);
  if (!v) {
    v = "demo-" + uid();
    localStorage.setItem(k, v);
  }
  return v;
}

// ─── localStorage persistence ─────────────────────────────────────
const SAVED_KEY = "isuct_bot_saved_entity";

function loadSaved(): SelectedEntity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SelectedEntity;
    if (parsed && parsed.type && parsed.id && parsed.name) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

function saveEntity(e: SelectedEntity) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(e));
  } catch {
    /* ignore */
  }
}

function clearSaved() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(SAVED_KEY);
  } catch {
    /* ignore */
  }
}

// ─── Multi-group: pinned entities list ────────────────────────────
// Lets a user save multiple groups/teachers/auditoriums and switch
// between them quickly via a "📌 Избранное" menu.
const PINNED_KEY = "isuct_bot_pinned";
const PINNED_MAX = 6;

function loadPinned(): SelectedEntity[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (Array.isArray(arr))
      return arr
        .filter((e) => e?.type && e?.id && e?.name)
        .slice(0, PINNED_MAX);
  } catch {
    /* ignore */
  }
  return [];
}

function savePinned(list: SelectedEntity[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify(list.slice(0, PINNED_MAX)));
  } catch {
    /* ignore */
  }
}

function addPinned(e: SelectedEntity): SelectedEntity[] {
  const cur = loadPinned();
  const filtered = cur.filter(
    (x) => !(x.type === e.type && x.id === e.id),
  );
  filtered.unshift(e);
  const next = filtered.slice(0, PINNED_MAX);
  savePinned(next);
  return next;
}

function removePinned(e: SelectedEntity): SelectedEntity[] {
  const cur = loadPinned();
  const next = cur.filter(
    (x) => !(x.type === e.type && x.id === e.id),
  );
  savePinned(next);
  return next;
}

function isPinned(e: SelectedEntity): boolean {
  return loadPinned().some(
    (x) => x.type === e.type && x.id === e.id,
  );
}

// ─── Search history (recent entities) ─────────────────────────────
const HISTORY_KEY = "isuct_bot_history";
const HISTORY_MAX = 4;

function loadHistory(): SelectedEntity[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.filter((e) => e?.type && e?.id && e?.name).slice(0, HISTORY_MAX);
  } catch {
    /* ignore */
  }
  return [];
}

function pushHistory(e: SelectedEntity) {
  if (typeof window === "undefined") return;
  try {
    const cur = loadHistory();
    const filtered = cur.filter(
      (x) => !(x.type === e.type && x.id === e.id),
    );
    filtered.unshift(e);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered.slice(0, HISTORY_MAX)));
  } catch {
    /* ignore */
  }
}

// ─── Notification reminders ────────────────────────────────────────
// In-memory set of active reminder timeouts so we don't schedule duplicates
// or leak timers when the component re-renders.
const activeReminders = new Map<string, ReturnType<typeof setTimeout>>();

interface ReminderData {
  lessonTime: string | null;
  subject: string | null;
  leadMinutes: number;
  message: string;
}

/** Request notification permission + schedule a browser notification. */
async function scheduleReminder(r: ReminderData): Promise<void> {
  if (typeof window === "undefined") return;
  if (!r.lessonTime || !r.subject) return;

  // Request permission if needed
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      return;
    }
  }
  if (Notification.permission !== "granted") return;

  const lessonDate = new Date(r.lessonTime);
  const reminderTime = new Date(lessonDate.getTime() - r.leadMinutes * 60_000);
  const delay = reminderTime.getTime() - Date.now();

  if (delay <= 0) {
    // Fire immediately (lesson is within the lead window or started)
    fireNotification(r.subject, r.message);
    return;
  }

  // Clear any existing reminder for this lesson to avoid duplicates
  const key = r.lessonTime;
  const existing = activeReminders.get(key);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    fireNotification(r.subject!, r.message);
    activeReminders.delete(key);
  }, delay);
  activeReminders.set(key, timer);
}

function fireNotification(subject: string, body: string) {
  try {
    new Notification("🔔 Скоро пара", {
      body: `${subject}\n${body}`,
      icon: "/logo.svg",
      tag: "isuct-reminder",
    });
  } catch {
    /* ignore */
  }
}

const TYPE_ICON: Record<ScheduleType, string> = {
  group: "🎓",
  teacher: "👨‍🏫",
  auditorium: "🏫",
};

const TYPE_LABEL_RU: Record<ScheduleType, string> = {
  group: "Группа",
  teacher: "Преподаватель",
  auditorium: "Аудитория",
};

export function TelegramChat() {
  const [chatId, setChatId] = useState<string>("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [needsText, setNeedsText] = useState(false);
  const [currentType, setCurrentType] = useState<ScheduleType | null>(null);
  const [savedEntity, setSavedEntity] = useState<SelectedEntity | null>(null);
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loadingSugg, setLoadingSugg] = useState(false);
  const [history, setHistory] = useState<SelectedEntity[]>([]);
  const [pinned, setPinned] = useState<SelectedEntity[]>([]);
  const [showPinned, setShowPinned] = useState(false);
  const [botState, setBotState] = useState<string>("menu_type");
  const scrollRef = useRef<HTMLDivElement>(null);
  const suggTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setChatId(getOrCreateChatId());
    setSavedEntity(loadSaved());
    setHistory(loadHistory());
    setPinned(loadPinned());
  }, []);

  const callApi = useCallback(
    async (input: unknown, asUser?: { text: string }) => {
      setLoading(true);
      setShowSuggestions(false);
      try {
        const res = await fetch("/api/bot/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, input }),
        });
        const data: Reply = await res.json();
        setMessages((prev) => {
          let next = [...prev];
          if (asUser) {
            next.push({ id: uid(), role: "user", html: asUser.text });
          }
          const tint = data.text ? detectTint(data.text) : null;
          if (data.edit && next.length && next[next.length - 1].role === "bot") {
            const last = next[next.length - 1];
            next[next.length - 1] = {
              ...last,
              html: data.text,
              keyboard: data.keyboard,
              lessonTint: tint,
            };
          } else {
            next.push({
              id: uid(),
              role: "bot",
              html: data.text,
              keyboard: data.keyboard,
              lessonTint: tint,
            });
          }
          return next;
        });
        setNeedsText(data.state === "enter_query");
        setCurrentType(data.type);
        setBotState(data.state);

        // Persist / clear saved entity + push to history
        if (data.selected) {
          saveEntity(data.selected);
          setSavedEntity(data.selected);
          pushHistory(data.selected);
          setHistory(loadHistory());
        }
        // Show resume button only at the top-level type menu

        // Handle notification reminder request
        if (data.reminder?.lessonTime && data.reminder.subject) {
          await scheduleReminder(data.reminder);
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: "bot",
            html: "⚠️ Не удалось связаться с сервером. Попробуйте ещё раз.",
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [chatId],
  );

  // initial greeting
  useEffect(() => {
    if (!chatId) return;
    callApi({ kind: "start" });
  }, [chatId, callApi]);

  // Check for saved entity after initial load
  useEffect(() => {
    if (chatId && savedEntity) {
    }
  }, [chatId, savedEntity]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading, showSuggestions]);

  // ─── Autocomplete: debounced search as user types ──────────────
  useEffect(() => {
    if (!needsText || !currentType || text.trim().length < 1) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    if (suggTimer.current) clearTimeout(suggTimer.current);
    suggTimer.current = setTimeout(async () => {
      setLoadingSugg(true);
      try {
        const res = await fetch(
          `/api/schedule/search?type=${currentType}&query=${encodeURIComponent(text.trim())}`,
        );
        const data = await res.json();
        setSuggestions(data.results || []);
        setShowSuggestions((data.results || []).length > 0);
      } catch {
        setSuggestions([]);
        setShowSuggestions(false);
      } finally {
        setLoadingSugg(false);
      }
    }, 250);
    return () => {
      if (suggTimer.current) clearTimeout(suggTimer.current);
    };
  }, [text, needsText, currentType]);

  const onButton = (b: InlineButton) => {
    callApi({ kind: "callback", data: b.callback_data }, { text: b.text });
  };

  const onSendText = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || loading) return;
    setText("");
    setSuggestions([]);
    setShowSuggestions(false);
    callApi({ kind: "text", text: t }, { text: t });
  };

  const onPickSuggestion = (s: SearchResult) => {
    setText("");
    setSuggestions([]);
    setShowSuggestions(false);
    callApi({ kind: "text", text: s.name }, { text: s.name });
  };

  const onReset = () => {
    clearSaved();
    setSavedEntity(null);
    callApi({ kind: "start" });
  };

  /** Pick any saved/history/popular entity → resume directly into its schedule. */
  const onPickEntity = (e: SelectedEntity) => {
    callApi(
      {
        kind: "resume",
        resumeType: e.type,
        resumeId: e.id,
        resumeName: e.name,
      },
      { text: `${TYPE_ICON[e.type]} ${e.name}` },
    );
  };

  /** Toggle pin status for the currently-selected entity. */
  const onTogglePin = () => {
    if (!savedEntity) return;
    if (isPinned(savedEntity)) {
      setPinned(removePinned(savedEntity));
    } else {
      setPinned(addPinned(savedEntity));
    }
  };

  /** Remove a pinned entity (from the pinned panel). */
  const onUnpin = (e: SelectedEntity) => {
    setPinned(removePinned(e));
  };

  const lastBotWithKeyboard = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "bot" && messages[i].keyboard?.length)
        return messages[i];
    }
    return undefined;
  })();

  return (
    <div className="relative mx-auto w-full max-w-[400px]">
      {/* glow */}
      <div
        aria-hidden
        className="absolute -inset-4 -z-10 rounded-[2.5rem] bg-gradient-to-tr from-emerald-400/20 via-teal-400/10 to-amber-300/20 blur-2xl"
      />
      <div className="overflow-hidden rounded-[2rem] border border-border bg-card shadow-2xl shadow-emerald-950/10 ring-1 ring-black/5">
        {/* phone status bar */}
        <div className="flex items-center justify-between bg-gradient-to-r from-emerald-800 to-teal-800 px-5 pt-1.5 text-[10px] font-medium text-white/90">
          <span className="tabular-nums">9:41</span>
          <div className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded-[1px] bg-white/80" />
            <span className="inline-block h-2 w-4 rounded-[1px] border border-white/60 bg-white/20" />
          </div>
        </div>
        {/* phone header */}
        <div className="flex items-center gap-3 bg-gradient-to-r from-emerald-700 to-teal-700 px-4 py-2.5 text-white">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25">
            <GraduationCap className="h-5 w-5" />
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-emerald-700 bg-emerald-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 truncate text-sm font-semibold">
              ISUCT Schedule Reborn
            </div>
            <div className="truncate text-[11px] text-emerald-100/80">
              <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300 align-middle" />
              бот · онлайн
            </div>
          </div>
          {/* [TEMPORARILY DISABLED — Pin/Bookmark buttons commented out] */}
          {/* {savedEntity && (
            <button
              onClick={onTogglePin}
              title={
                isPinned(savedEntity)
                  ? "Убрать из избранного"
                  : "Добавить в избранное"
              }
              className="rounded-full p-1.5 text-emerald-100/70 transition hover:bg-white/10 hover:text-white"
              aria-label="Избранное"
            >
              <Pin
                className="h-4 w-4"
                fill={isPinned(savedEntity) ? "currentColor" : "none"}
              />
            </button>
          )} */}
          {savedEntity && (
            <button
              onClick={onReset}
              title="Сбросить сохранённое расписание"
              className="rounded-full p-1.5 text-emerald-100/70 transition hover:bg-white/10 hover:text-white"
              aria-label="Сбросить"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
          {/* <button
            onClick={() => setShowPinned((v) => !v)}
            title="Избранные группы"
            className="rounded-full p-1.5 text-emerald-100/70 transition hover:bg-white/10 hover:text-white"
            aria-label="Избранные"
          >
            <Bookmark className="h-4 w-4" />
            {pinned.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-amber-400 text-[8px] font-bold text-emerald-900">
                {pinned.length}
              </span>
            )}
          </button> */}
          <MoreVertical className="h-4 w-4 text-emerald-100/80" />
        </div>

        {/* [TEMPORARILY DISABLED — Pinned entities dropdown] */}
        {/* <AnimatePresence>
          {showPinned && (
            <motion.div ...>
              ...
            </motion.div>
          )}
        </AnimatePresence> */}

        {/* messages */}
        <div
          ref={scrollRef}
          className="chat-scroll flex h-[460px] flex-col gap-2 overflow-y-auto bg-[#e9eef2] px-3 py-4 pb-6 dark:bg-[#0f1419]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 10%, rgba(16,185,129,0.05), transparent 40%), radial-gradient(circle at 80% 80%, rgba(245,158,11,0.05), transparent 40%)",
          }}
        >
          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
              >
                <div
                  className={cn(
                    "flex",
                    m.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[13px] leading-relaxed shadow-sm",
                      m.role === "user"
                        ? "rounded-br-md bg-emerald-600 text-white"
                        : cn(
                            "rounded-bl-md bg-white text-foreground dark:bg-[#1c2733] dark:text-zinc-100",
                            m.lessonTint && "border-l-[3px]",
                            m.lessonTint,
                          ),
                    )}
                    dangerouslySetInnerHTML={{ __html: safeHtml(m.html) }}
                  />
                </div>
                {m.role === "user" && (
                  <div className="flex justify-end pr-1 pt-0.5">
                    <CheckCheck className="h-3 w-3 text-emerald-600/70 dark:text-emerald-400/70" />
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
          {loading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-white px-3 py-2.5 shadow-sm dark:bg-[#1c2733]">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-500" />
              </div>
            </div>
          )}

          {/* inline keyboard attached to last bot message */}
          {!loading && lastBotWithKeyboard && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: 0.05 }}
              className="space-y-1.5 pt-1"
            >
              {lastBotWithKeyboard.keyboard!.map((row, ri) => (
                <div key={ri} className="flex flex-wrap gap-1.5">
                  {row.map((b, bi) => (
                    <button
                      key={bi}
                      onClick={() => onButton(b)}
                      className="flex-1 rounded-lg border border-emerald-200 bg-white px-2.5 py-2 text-center text-[12px] font-medium text-emerald-700 shadow-sm transition hover:border-emerald-400 hover:bg-emerald-50 active:scale-[0.98] dark:border-emerald-800/60 dark:bg-[#16202b] dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                    >
                      {b.text}
                    </button>
                  ))}
                </div>
              ))}

              {/* History chips — shown when entering a search query */}
              {botState === "enter_query" && history.length > 0 && (
                <div className="pt-1.5">
                  <div className="mb-1 flex items-center gap-1 px-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700/60 dark:text-emerald-400/60">
                    <History className="h-3 w-3" />
                    Недавние
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {history.map((e, i) => (
                      <button
                        key={i}
                        onClick={() => onPickEntity(e)}
                        className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11.5px] font-medium text-slate-600 shadow-sm transition hover:border-slate-400 hover:bg-slate-100 active:scale-95 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        <span className="text-[10px]">{TYPE_ICON[e.type]}</span>
                        {e.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </div>

        {/* text input + autocomplete */}
        <div className="relative border-t border-border bg-white dark:bg-[#0f1419]">
          {/* Autocomplete dropdown */}
          <AnimatePresence>
            {showSuggestions && suggestions.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.15 }}
                className="absolute bottom-full left-2 right-2 mb-1 max-h-48 overflow-y-auto rounded-xl border border-border bg-white py-1 shadow-xl dark:bg-[#1c2733]"
              >
                {suggestions.slice(0, 6).map((s, i) => (
                  <button
                    key={i}
                    onClick={() => onPickSuggestion(s)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                  >
                    <Search className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    <span className="truncate">{s.name}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <form
            onSubmit={onSendText}
            className="flex items-center gap-2 px-3 py-2"
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                needsText
                  ? "Введите группу / ФИО…"
                  : "Взаимодействуйте через кнопки выше"
              }
              disabled={loading}
              className="h-9 flex-1 rounded-full border border-border bg-muted/40 px-3 text-sm outline-none focus:border-emerald-400 focus:bg-background dark:bg-[#1c2733]"
            />
            {loadingSugg && (
              <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
            )}
            <button
              type="submit"
              disabled={loading || !text.trim()}
              aria-label="Отправить"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow transition hover:bg-emerald-700 disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
