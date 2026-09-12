import { NextRequest, NextResponse } from "next/server";
import { getPopular, getPopularByType } from "@/lib/isuct/schedule-store";
import type { ScheduleType } from "@/lib/isuct/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: ScheduleType[] = ["group", "teacher", "auditorium"];

export async function GET(req: NextRequest) {
  const typeParam = req.nextUrl.searchParams.get("type") as ScheduleType | null;
  const limit = Math.min(
    Number(req.nextUrl.searchParams.get("limit") || "6"),
    20,
  );
  if (typeParam && TYPES.includes(typeParam)) {
    return NextResponse.json({ results: getPopularByType(typeParam, limit) });
  }
  return NextResponse.json({ results: getPopular(limit) });
}
