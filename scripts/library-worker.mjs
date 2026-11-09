import { setTimeout as delay } from "node:timers/promises";
import { Worker } from "node:worker_threads";
import { createClient } from "@supabase/supabase-js";
import { BUCKET, FILE_LIMIT } from "../src/features/library/formats.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_WORKER_KEY;
if (!url || !key) throw new Error("Set the Supabase URL and SUPABASE_WORKER_KEY before starting the library worker.");

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, options) => fetch(input, { ...options, signal: AbortSignal.timeout(35_000) }) },
});
const storage = db.storage.from(BUCKET);

function runParser(stage, mime, bytes) {
  const worker = new Worker(new URL("../src/features/library/parser-thread.mjs", import.meta.url), {
    workerData: { stage, mime, bytes },
    transferList: [bytes],
    resourceLimits: { maxOldGenerationSizeMb: 192 },
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Parser time limit")), 25_000);
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", () => reject(new Error("Parser exited without output")));
    worker.once("exit", () => clearTimeout(timer));
  }).finally(() => worker.terminate());
}

async function work(job) {
  if (job.stage === "cleanup") {
    const { error } = await storage.remove([job.storage_key]);
    return { status: error ? "retry" : "purged" };
  }
  if (job.deleted_at || job.attempts > 3) return { status: "failed" };
  const { data, error } = await storage.download(job.storage_key);
  if (error || !data) return { status: "retry" };
  if (data.size !== job.byte_size || data.size > FILE_LIMIT) {
    return { status: job.stage === "verify" ? "rejected" : "failed" };
  }
  return runParser(job.stage, job.mime_type, await data.arrayBuffer());
}

async function tick() {
  const { data, error } = await db.rpc("claim_material_job");
  if (error) throw new Error("Could not claim a library job.");
  const job = data?.[0];
  if (!job) return false;
  let result;
  try {
    result = await work(job);
  } catch {
    result = { status: "retry" };
  }
  const { error: finishError } = await db.rpc("finish_material_job", {
    target_id: job.material_id,
    token: job.lease_token,
    outcome: result.status,
    result_hash: result.sha256 ?? null,
    result_pages: result.page_count ?? null,
    result_chunks: result.chunks ?? [],
  });
  if (finishError) throw new Error("Could not record a library job result.");
  return true;
}

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
