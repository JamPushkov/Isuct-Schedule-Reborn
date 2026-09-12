import { NextRequest, NextResponse } from "next/server";
import { getAnalytics } from "@/lib/bot/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Overview stats for the admin dashboard.
 * Returns aggregate counters (sessions, searches, schedule views,
 * reminders, pins, photos) + popular groups.
 */
export async function GET(_req: NextRequest) {
  const analytics = getAnalytics();
  const uptimeMs = Date.now() - analytics.startedAt;
  const uptimeMin = Math.round(uptimeMs / 60000);
  return NextResponse.json({
    ...analytics,
    uptimeMinutes: uptimeMin,
  });
}
