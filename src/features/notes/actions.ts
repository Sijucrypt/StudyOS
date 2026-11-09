"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCourse, idSchema } from "@/features/academics/data";
import { authenticated } from "@/lib/auth/server";
import type { FormState } from "@/features/academics/actions";
import { normalizeNote } from "./content";

const saveInput = z.object({ title: z.string().trim().max(160), revision: z.number().int().positive(), body: z.unknown() });

export async function createNote(courseId: string): Promise<FormState> {
  const { course, parentArchived } = await getCourse(courseId);
  if (course.archived_at || parentArchived) return { error: "Restore the course before creating a note." };
  const { db } = await authenticated();
  const { data, error } = await db.from("notes").insert({ course_id: course.id }).select("id").single();
  if (error || !data) return { error: "The note could not be created. Try again." };
  revalidatePath("/courses/" + courseId + "/notes");
  redirect("/courses/" + courseId + "/notes/" + data.id);
}

export async function saveNote(courseId: string, id: string, input: unknown) {
  const { db, user } = await authenticated();
  if (!idSchema.safeParse(courseId).success || !idSchema.safeParse(id).success) return { error: "Invalid note." };
  const parsed = saveInput.safeParse(input);
  if (!parsed.success) return { error: "Check the note title and content." };
  const body = normalizeNote(parsed.data.body);
  if (!body) return { error: "The note is too large or contains unsupported formatting." };

  const { data, error } = await db.from("notes").update({ title: parsed.data.title || "Untitled note", body })
    .eq("id", id).eq("course_id", courseId).eq("user_id", user.id)
    .eq("revision", parsed.data.revision).is("deleted_at", null).select("revision").maybeSingle();
  if (error) return { error: "The note could not be saved. Try again." };
  if (!data) return { conflict: true };
  revalidatePath("/courses/" + courseId + "/notes");
  return { revision: data.revision as number };
}

export async function removeNote(courseId: string, id: string): Promise<FormState> {
  const { db, user } = await authenticated();
  if (!idSchema.safeParse(courseId).success || !idSchema.safeParse(id).success) return { error: "Invalid note." };
  const { data, error } = await db.from("notes").update({ deleted_at: new Date().toISOString() })
    .eq("id", id).eq("course_id", courseId).eq("user_id", user.id).is("deleted_at", null).select("id").maybeSingle();
  if (error || !data) return { error: "The note could not be removed." };
  const path = "/courses/" + courseId + "/notes";
  revalidatePath(path);
  redirect(path);
}
