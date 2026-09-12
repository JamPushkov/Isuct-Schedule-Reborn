import { NextResponse } from "next/server";
import { getCurrentParity, getSemesterStart } from "@/lib/isuct/schedule-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    currentParity: getCurrentParity(),
    semesterStart: getSemesterStart(),
    telegramConfigured: !!process.env.TELEGRAM_BOT_TOKEN,
    time: new Date().toISOString(),
  });
}
