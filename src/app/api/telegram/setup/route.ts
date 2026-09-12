import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  token?: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const token = (body.token || "").trim();
  if (!token || !/^\d+:.+$/.test(token)) {
    return NextResponse.json(
      { ok: false, error: "Неверный формат токена" },
      { status: 400 },
    );
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      return NextResponse.json(
        { ok: false, error: data.description || "Токен отклонён Telegram" },
        { status: 400 },
      );
    }
    return NextResponse.json({
      ok: true,
      bot: {
        id: data.result.id,
        username: data.result.username,
        first_name: data.result.first_name,
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Не удалось связаться с api.telegram.org" },
      { status: 502 },
    );
  }
}
