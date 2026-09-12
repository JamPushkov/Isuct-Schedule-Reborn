// Shared Telegram Bot API helpers.
// Used by the Next.js webhook route (/api/telegram/webhook) AND the standalone
// long-polling mini-service (mini-services/tg-bot) so behaviour is identical.

import type { BotReply, InlineButton } from "./engine";

const TG_API = "https://api.telegram.org";

export function isValidToken(token: string): boolean {
  return /^\d+:.+$/.test(token);
}

export async function tgCall<T = unknown>(
  token: string,
  method: string,
  payload: unknown,
): Promise<{ ok: boolean; result?: T; description?: string } | null> {
  try {
    const res = await fetch(`${TG_API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return (await res.json()) as { ok: boolean; result?: T; description?: string };
  } catch {
    return null;
  }
}

export interface SendOptions {
  editMessageId?: number | null;
  callbackId?: string | null;
}

/** Send (or edit) a bot reply in a Telegram chat.
 *  Returns the message_id of the sent/edited message (or null if it failed). */
export async function sendBotReply(
  token: string,
  chatId: number,
  reply: BotReply,
  opts: SendOptions = {},
): Promise<number | null> {
  if (opts.callbackId) {
    await tgCall(token, "answerCallbackQuery", {
      callback_query_id: opts.callbackId,
    });
  }

  const reply_markup = {
    inline_keyboard: reply.keyboard.map((row: InlineButton[]) =>
      row.map((b) => ({ text: b.text, callback_data: b.callback_data })),
    ),
  };

  if (reply.edit && opts.editMessageId) {
    const edited = await tgCall<{ message_id: number }>(token, "editMessageText", {
      chat_id: chatId,
      message_id: opts.editMessageId,
      text: reply.text,
      parse_mode: "HTML",
      reply_markup,
      disable_web_page_preview: true,
    });
    if (edited?.ok) {
      return opts.editMessageId;
    }
    // Fall back to sending a new message
    const sent = await tgCall<{ message_id: number }>(token, "sendMessage", {
      chat_id: chatId,
      text: reply.text,
      parse_mode: "HTML",
      reply_markup,
      disable_web_page_preview: true,
    });
    return sent?.ok ? (sent.result as { message_id: number }).message_id : null;
  } else {
    const sent = await tgCall<{ message_id: number }>(token, "sendMessage", {
      chat_id: chatId,
      text: reply.text,
      parse_mode: "HTML",
      reply_markup,
      disable_web_page_preview: true,
    });
    return sent?.ok ? (sent.result as { message_id: number }).message_id : null;
  }
}
