import Link from "next/link";
import { ActionForm, type FormAction } from "@/components/ui/action-form";
import { Submit } from "@/components/ui/submit";
import type { Course, Semester, Session, Topic } from "@/features/academics/data";

export function PeriodForm({ action, kind, item }: {
  action: FormAction; kind: "Session" | "Semester"; item?: Session | Semester;
}) {
  const value = item ? ("label" in item ? item.label : item.name) : "";
  return <ActionForm action={action}>
    <label>{kind === "Session" ? "Session label" : "Semester name"}
      <input name="name" defaultValue={value} required maxLength={100} />
    </label>
    <div className="fields">
      <label>Start date (optional)<input type="date" name="starts_on" defaultValue={item?.starts_on ?? ""} /></label>
      <label>End date (optional)<input type="date" name="ends_on" defaultValue={item?.ends_on ?? ""} /></label>
    </div>
    <Submit>{item ? "Save changes" : kind === "Session" ? "Create session" : "Create semester"}</Submit>
  </ActionForm>;
}

export function RecordAction({ action, label, mode }: { action: FormAction; label: string; mode: string }) {
  return <ActionForm action={action}>
    <input type="hidden" name="mode" value={mode} />
    <Submit variant="secondary">{label}</Submit>
  </ActionForm>;
}

export function SemesterPicker({ semesters, sessions, current }: {
  semesters: Semester[]; sessions: Map<string, Session>; current?: string;
}) {
  return <label>Location
    <select name="semester_id" defaultValue={current ?? ""}>
      <option value="">Standalone</option>
      {semesters.map((semester) => <option key={semester.id} value={semester.id}>
        {sessions.get(semester.academic_session_id)?.label} / {semester.name}
      </option>)}
    </select>
  </label>;
}

export function CourseFields({ course }: { course?: Course }) {
  return <>
    <div className="fields">
      <label>Course code<input name="code" maxLength={30} defaultValue={course?.code} required /></label>
      <label>Units<input name="units" type="number" min={0} max={2147483647} step={1} defaultValue={course?.units ?? 0} required /></label>
    </div>
    <label>Course title<input name="title" maxLength={160} defaultValue={course?.title} required /></label>
    <label>Description (optional)<textarea name="description" maxLength={2000} defaultValue={course?.description} /></label>
  </>;
}

export function CourseList({ courses, empty }: { courses: Course[]; empty: string }) {
  if (!courses.length) return <p>{empty}</p>;
  return <ul className="record-list">
    {courses.map((course) => <li key={course.id} className="row spread">
      <Link className="record-link" href={"/courses/" + course.id}>{course.code} · {course.title}</Link>
      <span className="tag">{course.archived_at ? "Archived" : course.units + (course.units === 1 ? " unit" : " units")}</span>
    </li>)}
  </ul>;
}

export function TopicFields({ topics, topic }: { topics: Topic[]; topic?: Topic }) {
  return <>
    <label>Topic title<input name="title" maxLength={160} defaultValue={topic?.title} required /></label>
    <label>Parent topic (optional)
      <select name="parent_topic_id" defaultValue={topic?.parent_topic_id ?? ""}>
        <option value="">Top level</option>
        {topics.filter((item) => item.id !== topic?.id && (!item.archived_at || item.id === topic?.parent_topic_id))
          .map((item) => <option key={item.id} value={item.id}>{item.title}{item.archived_at ? " (archived)" : ""}</option>)}
      </select>
    </label>
  </>;
}
