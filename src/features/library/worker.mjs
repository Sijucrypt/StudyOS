import { Worker } from "node:worker_threads";
import { createClient } from "@supabase/supabase-js";
import { BUCKET, FILE_LIMIT } from "./formats.mjs";

function runParser(parserPath, stage, mime, bytes) {
  const worker = new Worker(parserPath, {
    workerData: { stage, mime, bytes },
    transferList: [bytes],
    resourceLimits: { maxOldGenerationSizeMb: 192 },
  });
  let timer;
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Parser time limit")), 25_000);
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", () => reject(new Error("Parser exited without output")));
  }).finally(() => {
    clearTimeout(timer);
    return worker.terminate();
  });
}

export function createLibraryTick({ url, key, parserPath }) {
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, options) => fetch(input, { ...options, signal: AbortSignal.timeout(35_000) }) },
  });
  const storage = db.storage.from(BUCKET);

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
    return runParser(parserPath, job.stage, job.mime_type, await data.arrayBuffer());
  }

  return async function tick() {
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
  };
}
