import { createHash } from "node:crypto";
import { parentPort, workerData } from "node:worker_threads";
import { extractBytes, verifyBytes } from "./parse.mjs";

const bytes = Buffer.from(workerData.bytes);
try {
  if (workerData.stage === "verify") {
    await verifyBytes(bytes, workerData.mime);
    parentPort.postMessage({ status: "verified", sha256: createHash("sha256").update(bytes).digest("hex") });
  } else {
    parentPort.postMessage(await extractBytes(bytes, workerData.mime));
  }
} catch {
  parentPort.postMessage({ status: workerData.stage === "verify" ? "rejected" : "failed" });
}
