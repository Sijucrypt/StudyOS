import { setTimeout as sleep } from "node:timers/promises";
import { telegramRuntime, telegramService } from "../src/features/telegram/runtime.mjs";
import { runTelegramTick } from "../src/features/telegram/worker.mjs";

const runtime = telegramRuntime();
if (!runtime?.endpoint) {
  console.error("Telegram worker requires a Supabase URL, Telegram service key and bot token.");
  process.exit(1);
}
const db = telegramService(runtime);
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => controller.abort());

const once = process.argv.includes("--once");
const pollMs = runtime.mode === "fixture" ? 2000 : 30_000;
do {
  try {
    const count = await runTelegramTick(db, runtime, controller.signal);
    if (once) console.log("Telegram tick processed " + count + " delivery attempt(s).");
  } catch {
    console.error("Telegram worker tick failed. Pending work remains in the outbox.");
    if (once) process.exitCode = 1;
  }
  if (!once && !controller.signal.aborted) {
    await sleep(pollMs, undefined, { signal: controller.signal }).catch(() => {});
  }
} while (!once && !controller.signal.aborted);
