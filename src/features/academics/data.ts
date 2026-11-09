import { notFound } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import { authenticated } from "@/lib/auth/server";

export type Session = {
  id: string;
  label: string;
  starts_on: string | null;
  ends_on: string | null;
  archived_at: string | null;
};

export type Semester = Omit<Session, "label"> & {
  academic_session_id: string;
  name: string;
  harmattan_imported_at: string | null;
};

export type Course = {
  id: string;
  semester_id: string | null;
  code: string;
  title: string;
  units: number;
  description: string;
  archived_at: string | null;
};

export type Topic = {
  id: string;
  parent_topic_id: string | null;
  title: string;
  sort_order: number;
  completed_at: string | null;
  archived_at: string | null;
};

export type Profile = { display_name: string; timezone: string };
export const idSchema = z.uuid();

async function allRows<T>(
  read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const result: T[] = [];
  const size = 200;
  for (let offset = 0; ; offset += size) {
    const { data, error } = await read(offset, offset + size - 1);
    if (error || !data) throw new Error("Academic records could not be loaded.");
    result.push(...data);
    if (data.length < size) return result;
  }
}

export const academics = cache(async () => {
  const { db, user } = await authenticated();
  const [sessions, semesters, courses] = await Promise.all([
    allRows<Session>((from, to) => db.from("academic_sessions").select("id,label,starts_on,ends_on,archived_at")
      .eq("user_id", user.id).order("label").order("id").range(from, to)),
    allRows<Semester>((from, to) => db.from("semesters").select("id,academic_session_id,name,starts_on,ends_on,archived_at,harmattan_imported_at")
      .eq("user_id", user.id).order("name").order("id").range(from, to)),
    allRows<Course>((from, to) => db.from("courses").select("id,semester_id,code,title,units,description,archived_at")
      .eq("user_id", user.id).order("code").order("id").range(from, to)),
  ]);
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const semestersById = new Map(semesters.map((semester) => [semester.id, semester]));

  const activeSemesters = semesters.filter((semester) =>
    !semester.archived_at && !sessionsById.get(semester.academic_session_id)?.archived_at);
  const activeSemesterIds = new Set(activeSemesters.map(({ id }) => id));
  const activeCourses = courses.filter((course) =>
    !course.archived_at && (!course.semester_id || activeSemesterIds.has(course.semester_id)));

  return { sessions, semesters, courses, sessionsById, semestersById, activeSemesters, activeSemesterIds, activeCourses };
});

export async function getCourse(id: string) {
  if (!idSchema.safeParse(id).success) notFound();
  const data = await academics();
  const course = data.courses.find((item) => item.id === id);
  if (!course) notFound();
  return { course, data, parentArchived: Boolean(course.semester_id && !data.activeSemesterIds.has(course.semester_id)) };
}

export async function getSemester(sessionId: string, semesterId: string) {
  const data = await academics();
  const session = data.sessionsById.get(sessionId);
  const semester = data.semestersById.get(semesterId);
  if (!session || !semester || semester.academic_session_id !== session.id) notFound();
  return { data, session, semester };
}

export async function getTopics(courseId: string) {
  const { db, user } = await authenticated();
  return allRows<Topic>((from, to) => db.from("topics")
    .select("id,parent_topic_id,title,sort_order,completed_at,archived_at")
    .eq("user_id", user.id).eq("course_id", courseId)
    .order("sort_order").order("title").order("id").range(from, to));
}

export async function getProfile(): Promise<Profile> {
  const { db, user } = await authenticated();
  const { data, error } = await db.from("profiles").select("display_name,timezone").eq("id", user.id).maybeSingle();
  if (error) throw new Error("Profile could not be loaded.");
  return data ?? { display_name: "", timezone: "Africa/Lagos" };
}
