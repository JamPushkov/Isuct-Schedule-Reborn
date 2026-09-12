// Cloudflare Worker — прокси для Telegram webhook
//
// Этот Worker получает обновления от Telegram и пересылает их
// на ваш развернутый Next.js сервер (Vercel/Railway/и т.д.).
//
// Настройка:
//   1. Задайте переменную NEXT_APP_URL в Cloudflare Worker Settings
//      (например: https://isuct-schedule-reborn.vercel.app)
//   2. Установите webhook:
//      https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<worker-name>.<account>.workers.dev
//
// Альтернатива: если Next.js уже доступен по публичному URL,
// можно пропустить Worker и направить webhook напрямую на
// https://your-app.vercel.app/api/telegram/webhook

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/" && request.method === "GET") {
      return new Response("ISUCT Schedule Reborn — Worker is running ✅", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    // Proxy to the Next.js app
    const targetUrl = (env.NEXT_APP_URL || "").replace(/\/$/, "") + url.pathname + url.search;

    if (!env.NEXT_APP_URL) {
      return new Response(
        JSON.stringify({
          error: "NEXT_APP_URL not configured",
          message: "Задайте NEXT_APP_URL в Cloudflare Worker Settings (Settings → Variables)",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    // Forward the request
    const headers = new Headers(request.headers);
    headers.set("Host", new URL(env.NEXT_APP_URL).host);

    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: headers,
        body: request.method === "POST" ? await request.text() : undefined,
      });

      // Return the response from the Next.js app
      const body = await response.text();
      return new Response(body, {
        status: response.status,
        headers: {
          "Content-Type": response.headers.get("Content-Type") || "application/json",
        },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: "Failed to reach Next.js app",
          message: error.message,
          target: targetUrl,
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }
  },
};

export default worker;
