import { NextRequest, NextResponse } from "next/server";
import { getSchedule, getCurrentParity, getSemesterStart } from "@/lib/isuct/schedule-store";
import type { ScheduleType } from "@/lib/isuct/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: ScheduleType[] = ["group", "teacher", "auditorium"];

export async function GET(req: NextRequest) {
  const type = (req.nextUrl.searchParams.get("type") || "group") as ScheduleType;
  const id = req.nextUrl.searchParams.get("id") || "";
  const name = req.nextUrl.searchParams.get("name") || "";
  if (!TYPES.includes(type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }
  if (!name.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  const schedule = await getSchedule(type, id || name, name);
  return NextResponse.json({
    schedule,
    currentParity: getCurrentParity(),
    semesterStart: getSemesterStart(),
  });
}
