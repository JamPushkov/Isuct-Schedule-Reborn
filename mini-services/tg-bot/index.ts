// Standalone Telegram bot — LONG-POLLING mode (no public webhook URL needed).
// Runs in the background via `bun --hot` so it auto-restarts on changes.
//
// Usage:
//   TELEGRAM_BOT_TOKEN=123:abc bun run dev
//
// Shares the SAME engine + schedule logic as the Next.js webhook, so the bot
// behaves identically whether driven by webhook or polling.

import { getSession, saveSession } from "@/lib/bot/session";
import { processInput, type BotInput } from "@/lib/bot/engine";
import { isValidToken, sendBotReply, tgCall } from "@/lib/bot/telegram";

const PORT_INFO = 3107; // informational only — polling service needs no port

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
}

async function pollLoop(token: string) {
  let offset = 0;
  console.log(`[tg-bot] polling started (info port ${PORT_INFO})`);

  while (true) {
    try {
      const res = await tgCall<{ updates: TgUpdate[] }>(token, "getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message", "callback_query"],
      });
      if (!res?.ok || !res.result) {
        // backoff on error
        await sleep(2000);
        continue;
      }
      for (const u of res.result as unknown as TgUpdate[]) {
        offset = u.update_id + 1;
        await handleUpdate(token, u);
      }
    } catch (e) {
      console.error("[tg-bot] poll error:", e);
      await sleep(3000);
    }
  }
}

async function handleUpdate(token: string, update: TgUpdate) {
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
  }

  if (chatId == null || !input) return;

  const session = getSession(String(chatId));
  session.__chatId = String(chatId);
  const reply = await processInput(input, session);
  saveSession(String(chatId), reply.session);
  await sendBotReply(token, chatId, reply, { callbackId, editMessageId });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !isValidToken(token)) {
    console.error(
      "[tg-bot] TELEGRAM_BOT_TOKEN is missing or invalid. Set it and restart.",
    );
    // keep the process alive so --hot can pick up env on next change
    setInterval(() => {}, 60_000);
    return;
  }

  // Make sure no webhook is active (polling + webhook are mutually exclusive).
  const del = await tgCall(token, "deleteWebhook", { drop_pending_updates: false });
  console.log("[tg-bot] deleteWebhook:", del?.ok);

  const me = await tgCall<{ result: { username: string } }>(token, "getMe", {});
  if (me?.ok) {
    console.log(`[tg-bot] authorized as @${(me.result as any).username}`);
  }

  await pollLoop(token);
}

main().catch((e) => {
  console.error("[tg-bot] fatal:", e);
  process.exit(1);
});
