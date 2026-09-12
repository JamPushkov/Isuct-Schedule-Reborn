import { NextRequest, NextResponse } from "next/server";
import { getSession, saveSession } from "@/lib/bot/session";
import { processInput, type BotInput } from "@/lib/bot/engine";
import { isValidToken, sendBotReply, tgCall } from "@/lib/bot/telegram";
import { popDueReminders } from "@/lib/bot/reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TgChat {
  id: number;
  type: string;
}
interface TgCallback {
  id: string;
  data?: string;
  message?: { message_id: number; chat: TgChat; text?: string };
}
interface TgMessage {
  message_id: number;
  chat: TgChat;
  text?: string;
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallback;
  edited_message?: TgMessage;
}

export async function POST(req: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !isValidToken(token)) {
    return NextResponse.json(
      { ok: false, error: "TELEGRAM_BOT_TOKEN is not set" },
      { status: 503 },
    );
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const header = req.headers.get("x-telegram-bot-api-secret-token");
    if (header !== secret) {
      return NextResponse.json({ ok: false, error: "bad secret" }, { status: 401 });
    }
  }

  const update = (await req.json().catch(() => null)) as TgUpdate | null;
  if (!update) return NextResponse.json({ ok: false, error: "no body" }, { status: 400 });

  let chatId: number | null = null;
  let input: BotInput | null = null;
  let callbackId: string | null = null;
  let editMessageId: number | null = null;

  if (update.callback_query) {
    const cq = update.callback_query;
    callbackId = cq.id;
    if (cq.message) {
      chatId = cq.message.chat.id;
      editMessageId = cq.message.message_id;
    }
    input = { kind: "callback", data: cq.data || "" };
  } else if (update.message) {
    chatId = update.message.chat.id;
    const text = update.message.text || "";
    input = text === "/start" ? { kind: "start" } : { kind: "text", text };
  } else if (update.edited_message) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  if (chatId == null || !input) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const session = getSession(String(chatId));
  session.__chatId = String(chatId);
  const reply = await processInput(input, session);
  saveSession(String(chatId), reply.session);

  await sendBotReply(token, chatId, reply, { callbackId, editMessageId });

  // Fire any due reminders for this chat (best-effort, non-blocking).
  fireDueRemindersForChat(token, String(chatId)).catch(() => {});

  return NextResponse.json({ ok: true });
}

/** Check + fire due reminders for a specific chat. */
async function fireDueRemindersForChat(token: string, chatId: string) {
  const due = popDueReminders();
  for (const r of due) {
    if (r.chatId !== chatId) continue;
    await tgCall(token, "sendMessage", {
      chat_id: Number(chatId),
      text: `🔔 <b>Скоро пара!</b>\n\n📚 <b>${r.subject}</b>\n⏰ через ${r.leadMinutes} мин\n${r.entityName ? `🎓 ${r.entityName}` : ""}`,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  }
}

export async function GET() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  return NextResponse.json({
    ok: true,
    configured: !!token && isValidToken(token),
    message:
      token && isValidToken(token)
        ? "Telegram webhook is live. POST updates here."
        : "Set TELEGRAM_BOT_TOKEN env var to enable the Telegram bot.",
  });
}
