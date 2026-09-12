import Link from "next/link";
import {
  CalendarClock,
  CalendarDays,
  GraduationCap,
  Sparkles,
  Presentation,
  RefreshCw,
  Layers,
  MessageSquare,
  ShieldCheck,
  Heart,
  ArrowRight,
  Bell,
} from "lucide-react";
import { TelegramChat } from "@/components/schedule-bot/telegram-chat";
import { ConnectBot } from "@/components/schedule-bot/connect-bot";
import { WeekStatus } from "@/components/schedule-bot/week-status";
import { InfoSections } from "@/components/schedule-bot/info-sections";
import { HeroStats } from "@/components/schedule-bot/hero-stats";
import { AnalyticsDashboard } from "@/components/schedule-bot/analytics-dashboard";
import { InstallPrompt } from "@/components/schedule-bot/install-prompt";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const FEATURES = [
  {
    icon: GraduationCap,
    title: "Студентам и преподавателям",
    desc: "Выбор группы или ФИО преподавателя одним касанием. Бот запоминает выбор — при следующем запуске сразу открывает расписание.",
  },
  {
    icon: CalendarClock,
    title: "Сегодня / Завтра / Сейчас",
    desc: "Кнопки как в старом боте + «Сейчас»: покажет идущую пару с остатком времени или следующую сегодня.",
  },
  {
    icon: Layers,
    title: "Вся неделя одним списком",
    desc: "Компактный обзор всех пар недели с количеством занятий по дням. Переключение между I и II неделей.",
  },
  {
    icon: Bell,
    title: "Умные напоминания",
    desc: "Настрой напоминания за N минут до пары или утреннюю сводку дня на выбранное время. Кастомный ввод минут и времени.",
  },
  {
    icon: ShieldCheck,
    title: "Две недели (I / II)",
    desc: "Корректный учёт верхней и нижней недели. Текущая неделя определяется автоматически от начала семестра.",
  },
  {
    icon: RefreshCw,
    title: "Актуальное расписание",
    desc: "Данные берутся напрямую с сайта ИГХТУ. Подсветка текущей/следующей пары при просмотре «Сегодня».",
  },
];

const STEPS = [
  {
    n: "1",
    title: "Запустите бота",
    desc: "Нажмите /start — бот предложит выбрать, для кого нужно расписание.",
    icon: MessageSquare,
  },
  {
    n: "2",
    title: "Выберите студента или преподавателя",
    desc: "Студент вводит номер группы (2/25), преподаватель — фамилию и инициалы (Смирнов А.А.).",
    icon: Presentation,
  },
  {
    n: "3",
    title: "Нажмите Сегодня / Завтра / Неделя",
    desc: "Получите расписание мгновенно. «Неделя» открывает кнопки дней недели.",
    icon: CalendarDays,
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-emerald-50/40 via-background to-background dark:from-emerald-950/10">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-600 to-teal-600 text-white shadow">
            <GraduationCap className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">ISUCT Schedule Reborn</span>
            <span className="text-[10px] text-muted-foreground">
              Telegram-бот расписания
            </span>
          </div>
          <nav className="ml-auto hidden items-center gap-1 md:flex">
            <Link
              href="#demo"
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              Демо
            </Link>
            <Link
              href="#features"
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              Возможности
            </Link>
            <Link
              href="#faq"
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              Вопросы
            </Link>
            <Link
              href="#stats"
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              Статистика
            </Link>
            <Link
              href="#connect"
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              Подключить
            </Link>
          </nav>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section id="demo" className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 opacity-70"
            style={{
              backgroundImage:
                "radial-gradient(60% 50% at 80% 0%, rgba(16,185,129,0.12), transparent 60%), radial-gradient(50% 40% at 0% 20%, rgba(245,158,11,0.10), transparent 60%)",
            }}
          />
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 lg:grid-cols-2 lg:py-20">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
                <Sparkles className="h-3.5 w-3.5" />
                ISUCT Schedule Reborn · возрождение легенды
              </div>
              <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
                ISUCT Schedule
                <span className="block bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">
                  Reborn
                </span>
              </h1>
              <p className="max-w-md text-base text-muted-foreground">
                Студентам и преподавателям Ивановского государственного
                химико-технологического университета. Выбери группу или ФИО —
                получай расписание на сегодня, завтра и всю неделю в пару касаний.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button asChild size="lg" className="gap-2">
                  <Link href="#demo">
                    Попробовать демо <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href="#connect">Как подключить бота</Link>
                </Button>
              </div>
              <WeekStatus />
              <HeroStats />
            </div>
            <div className="lg:pl-6">
              <TelegramChat />
              <p className="mt-4 text-center text-xs text-muted-foreground">
                Это интерактивное демо. Реальный бот ведёт себя точно так же.
              </p>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="mx-auto max-w-6xl px-4 py-14">
          <div className="mb-10 text-center">
            <h2 className="text-2xl font-bold sm:text-3xl">Как это работает</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Три шага — и расписание у вас в чате
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {STEPS.map((s) => (
              <Card
                key={s.n}
                className="relative overflow-hidden border-border/70 p-6 shadow-sm"
              >
                <div className="absolute right-4 top-4 text-5xl font-black text-emerald-500/10">
                  {s.n}
                </div>
                <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <s.icon className="h-5 w-5" />
                </div>
                <h3 className="mb-1.5 font-semibold">{s.title}</h3>
                <p className="text-sm text-muted-foreground">{s.desc}</p>
              </Card>
            ))}
          </div>
        </section>

        {/* Features */}
        <section
          id="features"
          className="border-y border-border/60 bg-muted/20 py-14"
        >
          <div className="mx-auto max-w-6xl px-4">
            <div className="mb-10 text-center">
              <h2 className="text-2xl font-bold sm:text-3xl">
                Возможности бота
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Всё, что было в старом боте — и немного больше
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <Card
                  key={f.title}
                  className="border-border/60 p-5 transition hover:border-emerald-300 hover:shadow-md"
                >
                  <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500/15 to-teal-500/15 text-emerald-700 dark:text-emerald-300">
                    <f.icon className="h-5 w-5" />
                  </div>
                  <h3 className="mb-1.5 text-sm font-semibold">{f.title}</h3>
                  <p className="text-sm text-muted-foreground">{f.desc}</p>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Connect */}
        <section id="connect" className="mx-auto max-w-6xl px-4 py-16">
          <div className="mb-10 text-center">
            <h2 className="text-2xl font-bold sm:text-3xl">
              Подключите своего бота
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
              Создайте бота в @BotFather и подключите его к этому приложению за
              пару минут. Логика бота уже готова — нужно лишь указать токен.
            </p>
          </div>
          <ConnectBot />
        </section>

        {/* FAQ + Bell schedule */}
        <section id="faq" className="border-y border-border/60 bg-muted/20 py-14">
          <div className="mx-auto max-w-6xl px-4">
            <InfoSections />
          </div>
        </section>

        {/* Analytics dashboard */}
        <section id="stats" className="mx-auto max-w-6xl px-4 py-14">
          <div className="mb-8 text-center">
            <h2 className="text-2xl font-bold sm:text-3xl">Статистика бота</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Использование в реальном времени — обновляется каждые 30 секунд
            </p>
          </div>
          <AnalyticsDashboard />
        </section>

        {/* Source */}
        <section className="mx-auto max-w-6xl px-4 pb-8">
          <Card className="flex flex-col items-start justify-between gap-4 border-emerald-200/60 bg-emerald-50/40 p-6 dark:border-emerald-900/40 dark:bg-emerald-950/10 sm:flex-row sm:items-center">
            <div>
              <h3 className="font-semibold">Источник данных</h3>
              <p className="text-sm text-muted-foreground">
                Расписание берётся с официального сайта ИГХТУ:{" "}
                <a
                  href="https://www.isuct.ru/student/schedule"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-300"
                >
                  isuct.ru/student/schedule
                </a>
              </p>
            </div>
            <div className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">2 недели:</span>{" "}
              I неделя (нечётная) и II неделя (чётная). Отсчёт ведётся от
              начала семестра.
            </div>
          </Card>
        </section>
      </main>

      {/* PWA install prompt */}
      <InstallPrompt />

      {/* Footer (sticky to bottom) */}
      <footer className="mt-auto border-t border-border/70 bg-background/80">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-6 text-center sm:flex-row sm:justify-between sm:text-left">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-emerald-600 to-teal-600 text-white">
              <GraduationCap className="h-4 w-4" />
            </div>
            <span className="text-sm text-muted-foreground">
              ISUCT Schedule Reborn · сделано студентами для студентов
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Heart className="h-3.5 w-3.5 text-rose-400" />
            <span>Неофициальный проект. Данные с isuct.ru.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
