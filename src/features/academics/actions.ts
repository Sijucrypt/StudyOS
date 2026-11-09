"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authenticated } from "@/lib/auth/server";
import { academics, getCourse, getSemester, idSchema } from "./data";
import { courseSchema, periodSchema, profileSchema, topicSchema } from "./validation";

export type FormState = { error?: string; success?: string };

function fail(error: string): FormState {
  return { error };
}

function dbError(error: { code?: string } | null, duplicate: string): FormState {
  if (error?.code === "23505") return fail(duplicate);
  if (error?.code === "23503") return fail("The selected record is unavailable. Refresh and try again.");
  if (error?.code === "23514") return fail("This change violates a record constraint. Check the values and try again.");
  return fail("The change could not be saved. Refresh and try again.");
}

function saved(path: string): never {
  revalidatePath("/", "layout");
  redirect(path);
}

function archiveValue(form: FormData) {
  return form.get("mode") === "archive" ? new Date().toISOString() : null;
}

export async function saveSession(id: string | null, _: FormState, form: FormData) {
  const { db, user } = await authenticated();
  const parsed = periodSchema.safeParse({
    name: form.get("name"), starts_on: form.get("starts_on"), ends_on: form.get("ends_on"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const { name, ...dates } = parsed.data;
  const values = { label: name, ...dates };
  if (id && !idSchema.safeParse(id).success) return fail("Invalid session.");
  const query = id
    ? db.from("academic_sessions").update(values).eq("id", id).eq("user_id", user.id)
    : db.from("academic_sessions").insert({ ...values, user_id: user.id });
  const { data, error } = await query.select("id").single();
  if (error || !data) return dbError(error, "A session with that label already exists.");
  saved("/sessions");
}

export async function archiveSession(id: string, _: FormState, form: FormData) {
  const { db, user } = await authenticated();
  if (!idSchema.safeParse(id).success) return fail("Invalid session.");
  const { data, error } = await db.from("academic_sessions").update({ archived_at: archiveValue(form) })
    .eq("id", id).eq("user_id", user.id).select("id").single();
  if (error || !data) return dbError(error, "");
  saved("/sessions");
}

export async function saveSemester(sessionId: string, id: string | null, _: FormState, form: FormData) {
  const { db, user } = await authenticated();
  const { sessionsById } = await academics();
  const session = sessionsById.get(sessionId);
  if (!session || (!id && session.archived_at)) return fail("Choose an active academic session.");
  const parsed = periodSchema.safeParse({
    name: form.get("name"), starts_on: form.get("starts_on"), ends_on: form.get("ends_on"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  if (id && !idSchema.safeParse(id).success) return fail("Invalid semester.");
  const query = id
    ? db.from("semesters").update(parsed.data).eq("id", id).eq("academic_session_id", sessionId).eq("user_id", user.id)
    : db.from("semesters").insert({ ...parsed.data, academic_session_id: sessionId, user_id: user.id });
  const { data, error } = await query.select("id").single();
  if (error || !data) return dbError(error, "That semester name already exists in this session.");
  saved("/sessions/" + sessionId + "/semesters/" + data.id);
}

export async function archiveSemester(sessionId: string, id: string, _: FormState, form: FormData) {
  const { db, user } = await authenticated();
  await getSemester(sessionId, id);
  const { data, error } = await db.from("semesters").update({ archived_at: archiveValue(form) })
    .eq("id", id).eq("academic_session_id", sessionId).eq("user_id", user.id).select("id").single();
  if (error || !data) return dbError(error, "");
  saved("/sessions/" + sessionId + "/semesters/" + id);
}

export async function importHarmattan(sessionId: string, id: string) {
  const { db } = await authenticated();
  await getSemester(sessionId, id);
  const { data, error } = await db.rpc("import_harmattan", { target_semester: id });
  if (error) return fail("The import could not run. Check that this semester and its session are active.");
  saved("/sessions/" + sessionId + "/semesters/" + id + "?imported=" + data);
}

export async function saveCourse(id: string | null, _: FormState, form: FormData) {
  const { db, user } = await authenticated();
  const parsed = courseSchema.safeParse({
    code: form.get("code"), title: form.get("title"), units: form.get("units"), description: form.get("description"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  let query;
  if (id) {
    await getCourse(id);
    query = db.from("courses").update(parsed.data).eq("id", id).eq("user_id", user.id);
  } else {
    const { activeSemesterIds } = await academics();
    const semesterId = String(form.get("semester_id") ?? "") || null;
    if (semesterId && !activeSemesterIds.has(semesterId)) return fail("Choose an active semester or Standalone.");
    query = db.from("courses").insert({ ...parsed.data, semester_id: semesterId, user_id: user.id });
  }
  const { data, error } = await query.select("id").single();
  if (error || !data) return dbError(error, "This course code is already reserved in that semester.");
  saved("/courses/" + data.id);
}

export async function archiveCourse(id: string, _: FormState, form: FormData) {
  const { db, user } = await authenticated();
  await getCourse(id);
  const { data, error } = await db.from("courses").update({ archived_at: archiveValue(form) })
    .eq("id", id).eq("user_id", user.id).select("id").single();
  if (error || !data) return dbError(error, "");
  saved("/courses/" + id);
}

export async function transferCourse(id: string, _: FormState, form: FormData) {
  const { db, user } = await authenticated();
  const { course, data } = await getCourse(id);
  const semesterId = String(form.get("semester_id") ?? "") || null;
  const mode = form.get("mode");
  if (mode !== "move" && mode !== "copy") return fail("Choose Move or Copy.");
  if (semesterId && !data.activeSemesterIds.has(semesterId)) return fail("Choose an active semester or Standalone.");
  if (mode === "move" && semesterId === course.semester_id) return fail("Choose a different location.");
  const { code, title, units, description } = course;
  const query = mode === "move"
    ? db.from("courses").update({ semester_id: semesterId }).eq("id", id).eq("user_id", user.id)
    : db.from("courses").insert({ code, title, units, description, semester_id: semesterId, user_id: user.id });
  const { data: result, error } = await query.select("id").single();
  if (error || !result) return dbError(error, "That semester already has a course with this code.");
  saved("/courses/" + result.id + (mode === "move" ? "?moved=1" : "?copied=1"));
}

export async function saveTopic(courseId: string, id: string | null, _: FormState, form: FormData) {
  const { db, user } = await authenticated();
  const { course, parentArchived } = await getCourse(courseId);
  if (course.archived_at || parentArchived) return fail("Restore this course before editing topics.");
  const parsed = topicSchema.safeParse({ title: form.get("title"), parent_topic_id: form.get("parent_topic_id") });
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  if (id && !idSchema.safeParse(id).success) return fail("Invalid topic.");
  const query = id
    ? db.from("topics").update(parsed.data).eq("id", id).eq("course_id", courseId).eq("user_id", user.id)
    : db.from("topics").insert({ ...parsed.data, course_id: courseId, user_id: user.id });
  const { data, error } = await query.select("id").single();
  if (error?.code === "23514") return fail("Choose a parent outside this topic's own branch.");
  if (error || !data) return dbError(error, "");
  saved("/courses/" + courseId + "/topics");
}

export async function changeTopic(courseId: string, id: string, _: FormState, form: FormData) {
  const { db, user } = await authenticated();
  const { course, parentArchived } = await getCourse(courseId);
  if (course.archived_at || parentArchived) return fail("Restore this course before editing topics.");
  if (!idSchema.safeParse(id).success) return fail("Invalid topic.");
  const mode = form.get("mode");
  let values;
  switch (mode) {
    case "archive":
    case "restore":
      values = { archived_at: archiveValue(form) };
      break;
    case "complete":
    case "reopen":
      values = { completed_at: mode === "complete" ? new Date().toISOString() : null };
      break;
    default:
      return fail("Unknown topic action.");
  }
  const { data, error } = await db.from("topics").update(values)
    .eq("id", id).eq("course_id", courseId).eq("user_id", user.id).select("id").single();
  if (error || !data) return dbError(error, "");
  saved("/courses/" + courseId + "/topics");
}

export async function saveProfile(_: FormState, form: FormData) {
  const { db, user } = await authenticated();
  const parsed = profileSchema.safeParse({ display_name: form.get("display_name"), timezone: form.get("timezone") });
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const { error } = await db.from("profiles").upsert({ id: user.id, ...parsed.data });
  if (error) return dbError(error, "");
  saved("/settings?saved=1");
}
