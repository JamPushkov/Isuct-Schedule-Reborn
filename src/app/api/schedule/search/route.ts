import { NextRequest, NextResponse } from "next/server";
import { searchSchedule } from "@/lib/isuct/schedule-store";
import type { ScheduleType } from "@/lib/isuct/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: ScheduleType[] = ["group", "teacher", "auditorium"];

export async function GET(req: NextRequest) {
  const type = (req.nextUrl.searchParams.get("type") || "group") as ScheduleType;
  const query = req.nextUrl.searchParams.get("query") || "";
  if (!TYPES.includes(type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }
  if (!query.trim()) {
    return NextResponse.json({ results: [] });
  }
  const results = await searchSchedule(type, query);
  return NextResponse.json({ results });
}
