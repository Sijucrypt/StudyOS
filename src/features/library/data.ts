import { notFound } from "next/navigation";
import { authenticated } from "@/lib/auth/server";
import { idSchema } from "@/features/academics/data";

export type Material = {
  id: string;
  course_id: string;
  name: string;
  mime_type: string;
  byte_size: number;
  storage_key: string;
  upload_state: "pending" | "submitted" | "verified" | "rejected" | "expired";
  extraction_state: "waiting" | "queued" | "ready" | "needs_ocr" | "unsupported" | "failed";
  page_count: number | null;
};
const fields = "id,course_id,name,mime_type,byte_size,storage_key,upload_state,extraction_state,page_count";

export async function listMaterials(courseId: string | null, query: string, offset: number) {
  const { db } = await authenticated();
  const { data, error } = await db.rpc("search_materials", {
    course_scope: courseId, search_term: query, page_offset: offset,
  }).select(fields);
  if (error) throw new Error("Library could not be loaded.");
  const rows = data as Material[];
  return { materials: rows.slice(0, 50), hasNext: rows.length > 50 };
}

export async function getMaterial(courseId: string, id: string): Promise<Material> {
  const { db, user } = await authenticated();
  if (!idSchema.safeParse(id).success || !idSchema.safeParse(courseId).success) notFound();
  const { data, error } = await db.from("materials").select(fields)
    .eq("id", id).eq("course_id", courseId).eq("user_id", user.id).is("deleted_at", null).maybeSingle();
  if (error) throw new Error("Material could not be loaded.");
  if (!data) notFound();
  return data as Material;
}

export function materialStatus(material: Material) {
  if (material.upload_state !== "verified") {
    return {
      pending: "Awaiting upload",
      submitted: "Waiting for file verification",
      rejected: "Upload rejected or missing",
      expired: "Upload expired",
    }[material.upload_state];
  }
  return {
    waiting: "Original available",
    queued: "Waiting for text extraction",
    ready: "Text extracted",
    needs_ocr: "No PDF text found. OCR is unavailable.",
    unsupported: "Image available. Text extraction is unavailable.",
    failed: "Text extraction failed. The original is available.",
  }[material.extraction_state];
}
