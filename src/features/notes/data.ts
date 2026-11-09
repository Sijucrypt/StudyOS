import { notFound } from "next/navigation";
import { authenticated } from "@/lib/auth/server";
import { idSchema } from "@/features/academics/data";

type NoteListItem = { id: string; title: string; updated_at: string };

export async function listNotes(courseId: string) {
  const { db, user } = await authenticated();
  const notes: NoteListItem[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await db.from("notes").select("id,title,updated_at")
      .eq("course_id", courseId).eq("user_id", user.id).is("deleted_at", null)
      .order("updated_at", { ascending: false }).order("id").range(offset, offset + 199);
    if (error) throw new Error("Notes could not be loaded.");
    notes.push(...data);
    if (data.length < 200) return notes;
  }
}

export async function getNote(courseId: string, noteId: string) {
  const { db, user } = await authenticated();
  if (!idSchema.safeParse(noteId).success || !idSchema.safeParse(courseId).success) notFound();
  const { data, error } = await db.from("notes").select("id,title,body,revision")
    .eq("id", noteId).eq("course_id", courseId).eq("user_id", user.id).is("deleted_at", null).maybeSingle();
  if (error) throw new Error("Note could not be loaded.");
  if (!data) notFound();
  return data as { id: string; title: string; body: unknown; revision: number };
}
