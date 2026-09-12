import { NextRequest, NextResponse } from "next/server";
import { getSession, saveSession } from "@/lib/bot/session";
import { processInput, type BotInput } from "@/lib/bot/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  chatId?: string;
  input?: BotInput;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const chatId = body.chatId || "anon";
  const input = body.input || { kind: "start" };
  let session = getSession(chatId);
  session.__chatId = chatId;
  const reply = await processInput(input, session);
  saveSession(chatId, reply.session);
  return NextResponse.json({
    chatId,
    text: reply.text,
    keyboard: reply.keyboard,
    edit: !!reply.edit,
    state: reply.session.state,
    type: reply.session.type ?? null,
    selected: reply.session.selected ?? null,
    reminder: reply.reminder ?? null,
  });
}
