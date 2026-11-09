"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCourse, idSchema } from "@/features/academics/data";
import { authConfig } from "@/lib/auth/config";
import { authenticated } from "@/lib/auth/server";
import { BUCKET, FILE_LIMIT, materialType } from "./formats.mjs";

const uploadInput = z.object({
  name: z.string().trim().min(1).max(180).refine((name) =>
    Array.from(name).every((character) => character.charCodeAt(0) >= 32 && character !== "/" && character !== "\\")),
  size: z.number().int().positive().max(FILE_LIMIT),
});

export async function reserveUpload(courseId: string, input: unknown) {
  const { db } = await authenticated();
  const { course, parentArchived } = await getCourse(courseId);
  if (course.archived_at || parentArchived) return { error: "Restore the course before uploading files." };
  const values = uploadInput.safeParse(input);
  if (!values.success) return { error: "Use a valid filename and a file from 1 byte to 25 MB." };
  const { name, size } = values.data;
  const mime = materialType(name);
  if (!mime) return { error: "Choose a PDF, DOCX, PPTX, TXT, MD, JPEG or PNG file." };
  const { data, error } = await db.from("materials")
    .insert({ course_id: course.id, name, mime_type: mime, byte_size: size })
    .select("id,storage_key").single();
  if (error || !data) return { error: error?.code === "P0001"
    ? "Storage quota reached. Remove unused files or wait for expired uploads to clear."
    : "Could not reserve this upload." };
  const { data: signed, error: signingError } = await db.storage.from(BUCKET).createSignedUploadUrl(data.storage_key);
  if (signingError || !signed) {
    await db.rpc("change_material", { target_id: data.id, operation: "remove" });
    return { error: "Could not authorize the upload." };
  }
  const config = authConfig()!;
  const endpoint = new URL(config.url);
  if (/^[a-z0-9]+\.supabase\.co$/.test(endpoint.hostname)) {
    endpoint.hostname = endpoint.hostname.replace(".supabase.co", ".storage.supabase.co");
  }
  return { id: data.id as string, storageKey: data.storage_key as string, mime, token: signed.token,
    signedUrl: signed.signedUrl, tusEndpoint: new URL("/storage/v1/upload/resumable/sign", endpoint).href,
    publishableKey: config.key };
}

export async function changeMaterial(id: string, operation: "submit" | "retry" | "remove") {
  const { db } = await authenticated();
  if (!idSchema.safeParse(id).success || !["submit", "retry", "remove"].includes(operation)) {
    return { error: "Invalid file action." };
  }
  const { data, error } = await db.rpc("change_material", { target_id: id, operation });
  if (error || !data) return { error: "This file action is unavailable. Refresh and try again." };
  revalidatePath("/library");
  revalidatePath("/courses/[courseId]", "page");
  return { ok: true };
}
