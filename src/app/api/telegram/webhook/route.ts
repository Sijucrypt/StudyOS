import { telegramConfig } from "@/features/telegram/config";
import { matchesWebhookSecret, readTelegramCommand } from "@/features/telegram/protocol";
import { telegramService } from "@/features/telegram/runtime.mjs";

export const runtime = "nodejs";
const maxBodyBytes = 32_768;

async function boundedBody(request: Request) {
  const stream = request.body?.getReader();
  if (!stream) return null;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let received = 0;
  let body = "";
  try {
    for (;;) {
      const { value, done } = await stream.read();
      if (done) return JSON.parse(body + decoder.decode()) as unknown;
      received += value.byteLength;
      if (received > maxBodyBytes) {
        await stream.cancel();
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
  } catch {
    return null;
  } finally {
    stream.releaseLock();
  }
}

export async function POST(request: Request) {
  const config = telegramConfig();
  if (!config) return new Response(null, { status: 404 });
  if (!matchesWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"), config.secret)) {
    return new Response(null, { status: 401 });
  }
  const update = await boundedBody(request);
  if (update === null) return new Response(null, { status: 400 });
  const command = readTelegramCommand(update, config.username);
  if (!command) return new Response(null, { status: 204 });
  const { error } = await telegramService(config.runtime).rpc("telegram_handle_update", command);
  return new Response(null, { status: error ? 503 : 204 });
}
