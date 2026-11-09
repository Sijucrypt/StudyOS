import { z } from "zod";

const delivery = z.object({ chat_id: z.string().regex(/^\d{1,16}$/), message: z.string().min(1).max(4096) });
const claim = z.object({ id: z.uuid(), token: z.uuid() });

export async function deliverTelegram(runtime, payload, fetcher = fetch) {
  try {
    const response = await fetcher(runtime.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(runtime.mode === "fixture" ? { "x-studyos-fixture-key": runtime.key } : {}),
      },
      body: JSON.stringify({ chat_id: payload.chat_id, text: payload.message, link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(8_000),
      redirect: "error",
    });
    const body = await response.json().catch(() => null);
    if (response.ok && body?.ok === true && Number.isSafeInteger(body.result?.message_id)) {
      return { result: "sent", retry_seconds: 0 };
    }
    const error = body?.ok === false ? body.error_code : undefined;
    if (response.status === 429 || error === 429) {
      const delay = body?.parameters?.retry_after ?? Number(response.headers.get("retry-after"));
      return { result: "rate_limit", retry_seconds: Number.isSafeInteger(delay) && delay > 0 ? Math.min(delay, 2_147_483_647) : 0 };
    }
    if (Number.isInteger(error) && error >= 500 && error < 600) {
      return { result: "provider_unavailable", retry_seconds: 0 };
    }
    if (Number.isInteger(error) && error >= 400 && error < 500) {
      return { result: "telegram_rejected", retry_seconds: 0 };
    }
  } catch {
    // The provider may have accepted a request before the connection failed.
  }
  return { result: "delivery_unknown", retry_seconds: 0 };
}

export async function runTelegramTick(db, runtime, signal) {
  const refresh = await db.rpc("refresh_telegram_outbox");
  if (refresh.error) throw new Error("Could not refresh Telegram reminders.");
  let prepared = 0;
  for (let count = 0; count < 20 && !signal?.aborted; count++) {
    const next = await db.rpc("claim_telegram_outbox");
    if (next.error) throw new Error("Could not claim a Telegram reminder.");
    if (!next.data) break;
    const job = claim.parse(next.data);
    const args = { job_id: job.id, lease_token: job.token };
    const preparation = await db.rpc("prepare_telegram_send", args);
    if (preparation.error) throw new Error("Could not prepare a Telegram reminder.");
    if (!preparation.data) continue;
    const message = delivery.parse(preparation.data);
    prepared++;
    const outcome = await deliverTelegram(runtime, message);
    const finished = await db.rpc("finish_telegram_send", { ...args, ...outcome });
    if (finished.error || !finished.data) throw new Error("Could not record the Telegram outcome.");
  }
  return prepared;
}
