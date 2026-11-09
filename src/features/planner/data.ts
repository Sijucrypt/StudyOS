import { authenticated } from "@/lib/auth/server";

export type Recurrence = "once" | "daily" | "weekly";
export type Occurrence = {
  id: string; event_id: string; course_id: string | null; title: string;
  topic_id: string | null; topic_title: string | null;
  starts_at: string; ends_at: string; status: "planned" | "completed" | "cancelled";
  recurrence: Recurrence; repeat_until: string | null; timezone: string; series_retired: boolean;
};
export type Deadline = {
  id: string; course_id: string | null; title: string; due_at: string;
  category: "assignment" | "exam" | "other"; status: "open" | "done" | "cancelled";
};
export type StudyLog = {
  id: string; course_id: string | null; occurrence_id: string | null;
  started_at: string; finished_at: string | null; running_since: string | null;
  confirmed_through: string | null; elapsed_ms: number; corrected_seconds: number | null;
  status: "running" | "paused" | "completed" | "discarded"; revision: number;
  pause_reason: "manual" | "inactive" | null;
};
export type TimerSnapshot = { log: StudyLog | null; server_now: string };
export type StudyTopic = { id: string; course_id: string; title: string };
export type StudyWindow = {
  from_at: string; to_at: string; server_now: string; occurrences: Occurrence[]; deadlines: Deadline[];
};
export type StudyMetrics = {
  seconds: number; days_with_study: number; day_count: number;
  days: { date: string; seconds: number }[];
  topics: { completed: number; total: number };
  adherence: { completed: number; eligible: number };
  overdue: Pick<Deadline, "id" | "title" | "category" | "due_at">[];
  upcoming: Pick<Deadline, "id" | "title" | "category" | "due_at">[];
};

export async function getStudyWindow(first: string, last: string, zone: string, courseId: string | null = null) {
  const { db } = await authenticated();
  const { data, error } = await db.rpc("study_window", { first_day: first, last_day: last, view_zone: zone, course_scope: courseId });
  if (error || !data) throw new Error("The study calendar could not be loaded.");
  return data as StudyWindow;
}

export async function getStudyMetrics(first: string, last: string, zone: string, courseId: string | null = null) {
  const { db } = await authenticated();
  const { data, error } = await db.rpc("study_metrics", { first_day: first, last_day: last, view_zone: zone, course_scope: courseId });
  if (error || !data) throw new Error("Study analytics could not be loaded.");
  return data as StudyMetrics;
}

export async function getStudyTimer() {
  const { db } = await authenticated();
  const { data, error } = await db.rpc("study_timer", { operation: "read", payload: {} });
  if (error || !data) throw new Error("The study timer could not be loaded.");
  return data as TimerSnapshot;
}

export async function getStudyTopics(courseId: string | null) {
  const { db, user } = await authenticated();
  const topics: StudyTopic[] = [];
  for (let offset = 0; ; offset += 200) {
    const query = db.from("topics").select("id,course_id,title").eq("user_id", user.id).is("archived_at", null);
    const scoped = courseId ? query.eq("course_id", courseId) : query;
    const { data, error } = await scoped.order("title").order("id").range(offset, offset + 199);
    if (error || !data) throw new Error("Study topics could not be loaded.");
    topics.push(...data);
    if (data.length < 200) return topics;
  }
}

export async function getStudyLogs(courseId: string | null, page: number) {
  const { db, user } = await authenticated();
  const from = (page - 1) * 15;
  const query = db.from("study_logs").select(
    "id,course_id,occurrence_id,started_at,finished_at,elapsed_ms,corrected_seconds,status,revision",
  ).eq("user_id", user.id).eq("status", "completed");
  const scoped = courseId ? query.eq("course_id", courseId) : query;
  const { data, error } = await scoped.order("finished_at", { ascending: false }).order("id").range(from, from + 15);
  if (error || !data) throw new Error("Study logs could not be loaded.");
  return { logs: data.slice(0, 15) as StudyLog[], hasNext: data.length > 15 };
}

export function logSeconds(log: Pick<StudyLog, "corrected_seconds" | "elapsed_ms">) {
  return log.corrected_seconds ?? Math.floor(log.elapsed_ms / 1000);
}
