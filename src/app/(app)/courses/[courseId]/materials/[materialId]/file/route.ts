import { NextResponse } from "next/server";
import { authenticated } from "@/lib/auth/server";
import { getMaterial } from "@/features/library/data";
import { BUCKET } from "@/features/library/formats.mjs";

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

export async function GET(request: Request, { params }: { params: Promise<{ courseId: string; materialId: string }> }) {
  const { courseId, materialId } = await params;
  const { db } = await authenticated();
  const item = await getMaterial(courseId, materialId);
  const preview = new URL(request.url).searchParams.get("preview") === "1";
  const canPreview = ["application/pdf", "image/jpeg", "image/png"].includes(item.mime_type);
  if (item.upload_state !== "verified" || (preview && !canPreview)) {
    return new Response("File unavailable.", { status: 404, headers });
  }
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(
    item.storage_key, 120, preview ? {} : { download: item.name },
  );
  if (error || !data?.signedUrl) return new Response("Original temporarily unavailable.", { status: 503, headers });
  return preview
    ? NextResponse.json({ url: data.signedUrl }, { headers })
    : NextResponse.redirect(data.signedUrl, { headers });
}
