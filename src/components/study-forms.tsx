import { ActionForm } from "@/components/ui/action-form";
import { Submit } from "@/components/ui/submit";
import { changeSchedule, correctStudyLog } from "@/features/planner/actions";
import { localInput, type CalendarView } from "@/features/planner/dates";
import { logSeconds, type Deadline, type Occurrence, type StudyLog, type StudyTopic } from "@/features/planner/data";
import { StudySessionScope } from "./study-session-scope";

export type StudyFormContext = {
  scope: string | null;
  view: CalendarView;
  day: string;
  zone: string;
  courses: { id: string; label: string }[];
  topics: StudyTopic[];
};

function CourseSelect({ context, value }: { context: StudyFormContext; value?: string | null }) {
  if (context.scope) return null;
  return <label>Course
    <select name="course_id" defaultValue={value ?? ""}>
      <option value="">General study</option>
      {context.courses.map((course) => <option key={course.id} value={course.id}>{course.label}</option>)}
    </select>
  </label>;
}

export function SessionForm({ context, editing, series }: { context: StudyFormContext; editing?: Occurrence; series?: boolean }) {
  const operation = !editing ? "new_event" : series ? "replace_series" : "reschedule";
  const start = editing ? localInput(editing.starts_at, context.zone) : context.day + "T17:00";
  const minutes = editing ? Math.round((Date.parse(editing.ends_at) - Date.parse(editing.starts_at)) / 60_000) : 45;
  return <ActionForm action={changeSchedule.bind(null, context.scope, context.view, context.day, operation, editing?.id ?? null)}>
    <label>Session title<input name="title" maxLength={160} defaultValue={editing?.title} required /></label>
    <StudySessionScope scope={context.scope} courses={context.courses} topics={context.topics}
      initialCourse={editing?.course_id} initialTopic={editing?.topic_id} />
    <div className="fields">
      <label>Starts ({context.zone})<input type="datetime-local" name="local_time" defaultValue={start} required /></label>
      <label>Duration (minutes)<input type="number" name="duration_minutes" min={1} max={720} defaultValue={minutes} required /></label>
    </div>
    {(!editing || series) && <div className="fields">
      <label>Repeats<select name="recurrence" defaultValue={editing?.recurrence ?? "once"}>
        <option value="once">Does not repeat</option><option value="daily">Every day</option><option value="weekly">Every week</option>
      </select></label>
      <label>Repeat until (optional)<input type="date" name="repeat_until" defaultValue={editing?.repeat_until ?? ""} /></label>
    </div>}
    {series && <p>The replacement starts on the date you choose. Existing sessions in the past are preserved.</p>}
    <Submit>{editing ? "Save session changes" : "Add study session"}</Submit>
  </ActionForm>;
}

export function DeadlineForm({ context, editing }: { context: StudyFormContext; editing?: Deadline }) {
  return <ActionForm action={changeSchedule.bind(null, context.scope, context.view, context.day, "save_deadline", editing?.id ?? null)}>
    <label>Deadline title<input name="title" maxLength={160} defaultValue={editing?.title} required /></label>
    <CourseSelect context={context} value={editing?.course_id} />
    <div className="fields">
      <label>Deadline type<select name="category" defaultValue={editing?.category ?? "assignment"}>
        <option value="assignment">Assignment</option><option value="exam">Exam</option><option value="other">Other</option>
      </select></label>
      <label>Due ({context.zone})<input type="datetime-local" name="local_time"
        defaultValue={editing ? localInput(editing.due_at, context.zone) : context.day + "T18:00"} required /></label>
    </div>
    <Submit>{editing ? "Save deadline changes" : "Add deadline"}</Submit>
  </ActionForm>;
}

export function ScheduleButton({ context, operation, id, label, status }: {
  context: StudyFormContext; operation: "cancel_occurrence" | "cancel_series" | "deadline_status";
  id: string; label: string; status?: Deadline["status"];
}) {
  return <ActionForm action={changeSchedule.bind(null, context.scope, context.view, context.day, operation, id)}>
    {status && <input type="hidden" name="status" value={status} />}
    <Submit variant="secondary">{label}</Submit>
  </ActionForm>;
}

export function CorrectionForm({ log }: { log: StudyLog }) {
  return <ActionForm action={correctStudyLog.bind(null, log.id, log.revision)}>
    <label>Corrected duration (seconds)<input name="seconds" type="number" min={1} max={43200} defaultValue={logSeconds(log)} required /></label>
    <label>Reason for correction<input name="reason" maxLength={200} required /></label>
    <Submit variant="secondary">Save corrected time</Submit>
  </ActionForm>;
}
