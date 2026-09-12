import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";
import { ServiceWorkerRegister } from "@/components/service-worker-register";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ISUCT Schedule Reborn · Telegram бот расписания",
  description:
    "ISUCT Schedule Reborn — Telegram-бот для получения расписания занятий Ивановского государственного химико-технологического университета (ИГХТУ). Студентам и преподавателям — сегодня, завтра, на неделю.",
  keywords: [
    "ИГХТУ",
    "ISUCT",
    "Schedule Reborn",
    "расписание",
    "Telegram бот",
    "студент",
    "преподаватель",
    "isuct",
    "расписание занятий",
  ],
  authors: [{ name: "ISUCT Schedule Reborn" }],
  icons: {
    icon: "/logo.svg",
    apple: "/logo.svg",
  },
  manifest: "/manifest.json",
  openGraph: {
    title: "ISUCT Schedule Reborn",
    description:
      "Узнавай расписание занятий ИГХТУ в Telegram за пару касаний.",
    type: "website",
  },
};

export const viewport = {
  themeColor: "#059669",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          <Toaster />
          <ServiceWorkerRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
