import { timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { createLibraryTick } from "@/features/library/worker.mjs";

export const runtime = "nodejs";
export const maxDuration = 150;

const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const token = process.env.STUDYOS_LIBRARY_CRON_SECRET;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return new Response(null, { status: 404, headers });
  }

  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from("Bearer " + token);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return new Response(null, { status: 401, headers });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_WORKER_KEY;
  if (!url || !key) return new Response(null, { status: 503, headers });

  try {
    const tick = createLibraryTick({
      url,
      key,
      parserPath: resolve(process.cwd(), "src/features/library/parser-thread.mjs"),
    });
    return Response.json({ processed: await tick() }, { headers });
  } catch {
    return new Response(null, { status: 503, headers });
  }
}
