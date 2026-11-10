import { setTimeout as delay } from "node:timers/promises";
import { createLibraryTick } from "../src/features/library/worker.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_WORKER_KEY;
if (!url || !key) throw new Error("Set the Supabase URL and SUPABASE_WORKER_KEY before starting the library worker.");

const tick = createLibraryTick({
  url,
  key,
  parserPath: new URL("../src/features/library/parser-thread.mjs", import.meta.url),
});

if (process.argv.includes("--once")) {
  await tick();
} else {
  let running = true;
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { running = false; });
  while (running) {
    try {
      if (!(await tick())) await delay(3000);
    } catch {
      console.error("Library worker temporarily unavailable. Retrying.");
      await delay(15000);
    }
  }
}
