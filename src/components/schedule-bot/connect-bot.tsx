"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Copy,
  ExternalLink,
  Rocket,
  KeyRound,
  Webhook,
  Download,
  Github,
  Terminal,
  Lock,
  MessageCircle,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface BotInfo {
  id: number;
  username: string;
  first_name: string;
}

function CmdBlock({ label, cmd }: { label: string; cmd: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      <div className="group relative flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 font-mono text-[12.5px]">
        <code className="flex-1 break-all">{cmd}</code>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(cmd);
            setCopied(true);
            toast.success("Скопировано");
            setTimeout(() => setCopied(false), 1500);
          }}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
          aria-label="Копировать"
        >
          {copied ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}

function StepHeader({
  num,
  icon: Icon,
  title,
  done,
}: {
  num: number;
  icon: typeof KeyRound;
  title: string;
  done?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-sm transition ${
          done
            ? "bg-emerald-600"
            : "bg-gradient-to-br from-emerald-600 to-teal-600"
        }`}
      >
        {done ? (
          <CheckCircle className="h-5 w-5" />
        ) : (
          <Icon className="h-5 w-5" />
        )}
      </div>
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Шаг {num}
        </div>
        <h3 className="text-lg font-semibold leading-tight">{title}</h3>
      </div>
    </div>
  );
}

export function ConnectBot() {
  const [token, setToken] = useState("");
  const [appUrl, setAppUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [bot, setBot] = useState<BotInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [webhookSet, setWebhookSet] = useState(false);

  const verify = async () => {
    setLoading(true);
    setError(null);
    setBot(null);
    try {
      const res = await fetch("/api/telegram/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (data.ok) setBot(data.bot);
      else setError(data.error || "Ошибка");
    } catch {
      setError("Сеть недоступна");
    } finally {
      setLoading(false);
    }
  };

  const setWebhookFn = async () => {
    if (!token || !appUrl) return;
    setLoading(true);
    setError(null);
    setWebhookSet(false);
    try {
      const webhookUrl = appUrl.replace(/\/$/, "") + "/api/telegram/webhook";
      const res = await fetch(
        `https://api.telegram.org/bot${token}/setWebhook`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: webhookUrl }),
        },
      );
      const data = await res.json();
      if (data.ok) {
        setWebhookSet(true);
        toast.success("Webhook установлен!");
      } else {
        setError(data.description || "Ошибка установки webhook");
      }
    } catch {
      setError("Не удалось связаться с Telegram API");
    } finally {
      setLoading(false);
    }
  };

  const webhookUrl = token
    ? `https://api.telegram.org/bot${token}/setWebhook?url=YOUR_PUBLIC_URL/api/telegram/webhook`
    : "https://api.telegram.org/bot<TOKEN>/setWebhook?url=YOUR_PUBLIC_URL/api/telegram/webhook";

  return (
    <div className="space-y-10">
      {/* Download source */}
      <div className="rounded-2xl border-2 border-emerald-300 bg-gradient-to-br from-emerald-50 to-teal-50 p-6 dark:border-emerald-800/50 dark:from-emerald-950/20 dark:to-teal-950/20">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-600 text-white shadow-lg">
            <Download className="h-7 w-7" />
          </div>
          <div className="flex-1">
            <h3 className="text-xl font-bold">Исходный код бота</h3>
            <p className="text-sm text-muted-foreground">
              Скачайте код и разверните на своём сервере. Токен хранится только в
              переменных окружения — он не попадает в репозиторий.
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild size="lg" className="gap-2">
              <a href="/api/download" download>
                <Download className="h-4 w-4" />
                Скачать ZIP
              </a>
            </Button>
            <Button asChild variant="outline" size="lg" className="gap-2">
              <a
                href="https://github.com"
                target="_blank"
                rel="noreferrer"
              >
                <Github className="h-4 w-4" />
                GitHub
              </a>
            </Button>
          </div>
        </div>
      </div>

      {/* Security notice */}
      <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/10">
        <Lock className="h-5 w-5 shrink-0 text-emerald-600 mt-0.5" />
        <div className="text-sm">
          <b>Безопасность токена.</b> Токен бота хранится{" "}
          <b>только</b> в Vercel Environment Variables (зашифрован на сервере).
          Он <b>не попадает</b> в код на GitHub. Файл{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">.gitignore</code>{" "}
          блокирует все <code className="rounded bg-muted px-1.5 py-0.5 text-xs">.env*</code>{" "}
          файлы. Никто, кроме вас, не сможет управлять ботом.
        </div>
      </div>

      {/* Step 1: Create bot in BotFather */}
      <div className="space-y-4">
        <StepHeader num={1} icon={MessageCircle} title="Создайте бота в BotFather" />
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <ol className="space-y-3 text-sm">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                1
              </span>
              <div className="flex-1">
                Откройте{" "}
                <a
                  href="https://t.me/BotFather"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
                >
                  @BotFather <ExternalLink className="h-3 w-3" />
                </a>{" "}
                в Telegram и отправьте команду{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/newbot</code>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                2
              </span>
              <div className="flex-1">
                Введите имя бота (например:{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  ISUCT Schedule Reborn
                </code>
                ) — это отображаемое имя
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                3
              </span>
              <div className="flex-1">
                Введите username бота (например:{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  isuct_schedule_reborn_bot
                </code>
                ) — должен оканчиваться на{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">_bot</code>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                4
              </span>
              <div className="flex-1">
                BotFather пришлёт токен вида{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  123456789:ABCdefGhi...
                </code>
                . <b>Сохраните его</b> — он нужен для следующего шага.
              </div>
            </li>
          </ol>

          <div className="border-t border-border pt-4">
            <div className="mb-2 text-sm font-medium">Проверьте токен:</div>
            <div className="flex gap-2">
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="123456789:ABCdef..."
                className="font-mono text-sm"
                type="password"
              />
              <Button onClick={verify} disabled={loading || !token.trim()}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Проверить"
                )}
              </Button>
            </div>
            {bot && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-800/60 dark:bg-emerald-950/30">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>
                  Бот <b>@{bot.username}</b> ({bot.first_name}) — токен
                  действителен ✅
                </span>
              </div>
            )}
            {error && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Step 2: Deploy to Vercel */}
      <div className="space-y-4">
        <StepHeader num={2} icon={Rocket} title="Разверните приложение на Vercel" />
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <ol className="space-y-3 text-sm">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                1
              </span>
              <div className="flex-1">
                Распакуйте скачанный ZIP и загрузите код на{" "}
                <a
                  href="https://github.com/new"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
                >
                  GitHub
                </a>{" "}
                (создайте новый репозиторий)
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                2
              </span>
              <div className="flex-1">
                Зайдите на{" "}
                <a
                  href="https://vercel.com/new"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
                >
                  vercel.com/new <ExternalLink className="h-3 w-3" />
                </a>{" "}
                и выберите ваш репозиторий. Vercel автоматически определит
                Next.js и развернёт приложение.
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                3
              </span>
              <div className="flex-1">
                После деплоя вы получите URL вида{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  https://isuct-schedule-reborn.vercel.app
                </code>
              </div>
            </li>
          </ol>

          <div className="border-t border-border pt-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Lock className="h-4 w-4 text-emerald-600" />
              Добавьте переменные окружения в Vercel:
            </div>
            <p className="text-xs text-muted-foreground">
              Vercel Dashboard → ваш проект → <b>Settings → Environment Variables</b>.
              Эти переменные зашифрованы и не попадают в код.
            </p>
            <CmdBlock
              label="1. Токен бота (обязательно)"
              cmd={"TELEGRAM_BOT_TOKEN=" + (token || "<ВАШ_ТОКЕН>")}
            />
            <CmdBlock
              label="2. URL приложения (для cron-задач)"
              cmd={"NEXT_PUBLIC_BASE_URL=https://your-app.vercel.app"}
            />
          </div>

          <div className="border-t border-border pt-4">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle className="h-4 w-4 text-emerald-600" />
              <span>
                После добавления переменных Vercel автоматически пересоберёт
                приложение. Дождитесь окончания (1–2 минуты).
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Step 3: Set webhook */}
      <div className="space-y-4">
        <StepHeader
          num={3}
          icon={Webhook}
          title="Установите webhook"
          done={webhookSet}
        />
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            Webhook — это URL, на который Telegram будет присылать все
            сообщения и нажатия кнопок. Вставьте URL вашего приложения и
            нажмите кнопку.
          </p>

          <div className="flex gap-2">
            <Input
              value={appUrl}
              onChange={(e) => setAppUrl(e.target.value)}
              placeholder="https://your-app.vercel.app"
              className="text-sm"
            />
            <Button
              onClick={setWebhookFn}
              disabled={loading || !token.trim() || !appUrl.trim()}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : webhookSet ? (
                <>
                  <CheckCircle className="h-4 w-4" />
                  Установлено!
                </>
              ) : (
                "Установить webhook"
              )}
            </Button>
          </div>

          {webhookSet && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-800/60 dark:bg-emerald-950/30">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                Webhook установлен! Откройте бота в Telegram и нажмите{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  /start
                </code>
              </span>
            </div>
          )}

          <div className="border-t border-border pt-4 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              Или через командную строку:
            </div>
            <CmdBlock label="Установка webhook (curl)" cmd={webhookUrl} />
            <CmdBlock
              label="Проверка статуса webhook"
              cmd={
                token
                  ? `curl https://api.telegram.org/bot${token}/getWebhookInfo`
                  : "curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
              }
            />
          </div>
        </div>
      </div>

      {/* Step 4: Optional security */}
      <div className="space-y-4">
        <StepHeader num={4} icon={Lock} title="Дополнительная защита (опционально)" />
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <p className="text-sm text-muted-foreground">
            Для максимальной безопасности добавьте секретный токен — чтобы
            никто не мог отправлять фейковые запросы на ваш webhook.
          </p>
          <ol className="space-y-2 text-sm">
            <li className="flex gap-2">
              <span className="text-emerald-600 font-bold">1.</span>
              <span>
                В Vercel Environment Variables добавьте{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  TELEGRAM_WEBHOOK_SECRET
                </code>{" "}
                = случайная строка (например:{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  mySecret123abc
                </code>
                )
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-emerald-600 font-bold">2.</span>
              <span>
                Переустановите webhook с секретом (замените{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  SECRET
                </code>{" "}
                на вашу строку):
              </span>
            </li>
          </ol>
          <CmdBlock
            label="Установка webhook с секретом"
            cmd={
              token
                ? `curl "https://api.telegram.org/bot${token}/setWebhook?url=${appUrl || "YOUR_URL"}/api/telegram/webhook&secret_token=SECRET"`
                : `curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=YOUR_URL/api/telegram/webhook&secret_token=SECRET"`
            }
          />
        </div>
      </div>

      {/* Alternative: polling */}
      <div className="space-y-4">
        <StepHeader num={5} icon={Terminal} title="Альтернатива: Long-polling" />
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <p className="text-sm text-muted-foreground">
            Не хотите настраивать webhook? Запустите бота в режиме
            long-polling на любом сервере (VPS, компьютер) с доступом в
            интернет. Бот сам опрашивает Telegram.
          </p>
          <CmdBlock
            label="Установка зависимостей"
            cmd="cd mini-services/tg-bot && bun install"
          />
          <CmdBlock
            label="Запуск бота"
            cmd={"TELEGRAM_BOT_TOKEN=" + (token || "<ТОКЕН>") + " bun run dev"}
          />
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              При long-polling сервер должен работать 24/7. Cron-задачи
              (напоминания) не будут работать автоматически.
            </span>
          </div>
        </div>
      </div>

      {/* Final checklist */}
      <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50/50 p-5 dark:border-emerald-800/50 dark:bg-emerald-950/10">
        <h3 className="mb-3 flex items-center gap-2 text-base font-semibold">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          Чек-лист запуска
        </h3>
        <ul className="space-y-2 text-sm">
          {[
            "Бот создан в @BotFather, токен получен",
            "Код загружен на GitHub (без токена в коде!)",
            "Приложение развёрнуто на Vercel",
            "TELEGRAM_BOT_TOKEN добавлен в Vercel Environment Variables",
            "NEXT_PUBLIC_BASE_URL добавлен в Vercel Environment Variables",
            "Webhook установлен на https://your-app.vercel.app/api/telegram/webhook",
            "Бот отвечает на /start в Telegram ✅",
          ].map((item, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-emerald-400 text-emerald-600">
                <CheckCircle2 className="h-3 w-3" />
              </span>
              <span className="text-muted-foreground">{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
