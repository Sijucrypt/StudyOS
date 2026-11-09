"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticated } from "@/lib/auth/server";
import { getProfile, idSchema } from "@/features/academics/data";
import type { FormState } from "@/features/academics/actions";
import { logSeconds, type TimerSnapshot } from "./data";
import { calendarDate, calendarViews, localDate, plannerHref, plannerPath, type CalendarView } from "./dates";

type Operation = "new_event" | "replace_series" | "reschedule" | "cancel_occurrence" | "cancel_series" | "save_deadline" | "deadline_status";

const localTimestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/)
  .refine((value) => calendarDate.safeParse(value.slice(0, 10)).success);
const baseForm = z.object({
  title: z.string().trim().min(1).max(160),
  local_time: localTimestamp,
  course_id: idSchema.nullable(),
});
const eventForm = baseForm.extend({
  topic_id: idSchema.nullable(),
  recurrence: z.enum(["once", "daily", "weekly"]),
  repeat_until: calendarDate.nullable(),
  duration_minutes: z.coerce.number().int().min(1).max(720),
}).refine(({ recurrence, repeat_until, local_time }) => !repeat_until || recurrence !== "once" && repeat_until >= local_time.slice(0, 10));
const deadlineForm = baseForm.extend({ category: z.enum(["assignment", "exam", "other"]) });
const timerInput = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("start"), request_id: idSchema, occurrence_id: idSchema.nullable(), course_id: idSchema.nullable() }),
  z.object({ operation: z.enum(["heartbeat", "pause", "pause_hidden", "resume", "finish", "discard"]), id: idSchema, revision: z.number().int().positive() }),
]);

function refreshPlanner() {
  revalidatePath("/planner");
  revalidatePath("/analytics");
  revalidatePath("/dashboard");
  revalidatePath("/courses/[courseId]/planner", "page");
}

export async function changeSchedule(
  courseScope: string | null, view: CalendarView, returnDate: string, operation: Operation, id: string | null,
  _: FormState, form: FormData,
): Promise<FormState> {
  const { db } = await authenticated();
  const { timezone } = await getProfile();
  if ((id && !idSchema.safeParse(id).success) || (courseScope && !idSchema.safeParse(courseScope).success)) {
    return { error: "This planner item is unavailable." };
  }
  let payload: Record<string, unknown> = { id };
  let day = calendarDate.safeParse(returnDate).success ? returnDate : localDate(new Date(), timezone);
  const common = {
    title: form.get("title"), local_time: form.get("local_time"), course_id: courseScope ?? (form.get("course_id") || null),
  };
  if (operation === "new_event" || operation === "replace_series" || operation === "reschedule") {
    const repeat = operation === "reschedule" ? "once" : form.get("recurrence");
    const parsed = eventForm.safeParse({
      ...common, recurrence: repeat, repeat_until: repeat === "once" ? null : form.get("repeat_until") || null,
      topic_id: form.get("topic_id") || null,
      duration_minutes: form.get("duration_minutes"),
    });
    if (!parsed.success) return { error: "Check the title, start time, duration, and repeat end date." };
    payload = { ...payload, ...parsed.data, timezone };
    day = parsed.data.local_time.slice(0, 10);
  } else if (operation === "save_deadline") {
    const parsed = deadlineForm.safeParse({ ...common, category: form.get("category") });
    if (!parsed.success) return { error: "Check the deadline title, type, and due time." };
    payload = { ...payload, ...parsed.data, timezone };
    day = parsed.data.local_time.slice(0, 10);
  } else if (operation === "deadline_status") {
    const status = z.enum(["open", "done", "cancelled"]).safeParse(form.get("status"));
    if (!status.success) return { error: "Choose a deadline status." };
    payload.status = status.data;
  }
  const { error } = await db.rpc("study_schedule", { operation, payload });
  if (error) {
    if (error.code === "42501") return { error: "The course, topic, or planner item is unavailable." };
    if (error.code === "22023") return { error: "This change is unavailable. Choose a future time for edits and finish or discard any active timer for this session." };
    return { error: "The planner change could not be saved. Try again." };
  }
  refreshPlanner();
  redirect(plannerHref(plannerPath(courseScope), z.enum(calendarViews).safeParse(view).success ? view : "week", day));
}

export async function changeTimer(input: unknown): Promise<{ snapshot?: TimerSnapshot; error?: string }> {
  const { db } = await authenticated();
  const parsed = timerInput.safeParse(input);
  if (!parsed.success) return { error: "This timer action is invalid." };
  const { operation, ...payload } = parsed.data;
  const { data, error } = await db.rpc("study_timer", { operation, payload });
  if (error || !data) {
    if (error?.code === "22023" && operation === "finish") return { error: "Study for at least one second before finishing." };
    return { error: "The timer could not update. Refresh to check its saved state." };
  }
  if (operation === "finish" || operation === "discard") refreshPlanner();
  else if (operation !== "heartbeat") {
    revalidatePath("/planner");
    revalidatePath("/courses/[courseId]/planner", "page");
  }
  return { snapshot: data as TimerSnapshot };
}

export async function correctStudyLog(id: string, revision: number, _: FormState, form: FormData): Promise<FormState> {
  const { db } = await authenticated();
  const values = z.object({
    id: idSchema, revision: z.number().int().positive(), seconds: z.coerce.number().int().min(1).max(43200),
    reason: z.string().trim().min(1).max(200),
  }).safeParse({ id, revision, seconds: form.get("seconds"), reason: form.get("reason") });
  if (!values.success) return { error: "Enter a duration from 1 to 43,200 seconds and a reason." };
  const { data, error } = await db.rpc("study_timer", { operation: "correct", payload: values.data });
  if (error || !data) return { error: "The correction could not be saved." };
  const result = (data as TimerSnapshot).log;
  if (!result || result.status !== "completed" || logSeconds(result) !== values.data.seconds) {
    return { error: "The log changed in another tab. Refresh before correcting it." };
  }
  refreshPlanner();
  return { success: "Duration corrected." };
}
