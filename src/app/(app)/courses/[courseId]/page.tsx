import Link from "next/link";
import { CourseFields, RecordAction, SemesterPicker } from "@/components/academics";
import { ActionForm } from "@/components/ui/action-form";
import { Submit } from "@/components/ui/submit";
import { archiveCourse, saveCourse, transferCourse } from "@/features/academics/actions";
import { getCourse } from "@/features/academics/data";

export default async function CoursePage({ params, searchParams }: {
  params: Promise<{ courseId: string }>; searchParams: Promise<{ moved?: string; copied?: string }>;
}) {
  const { courseId } = await params;
  const [{ course, data, parentArchived }, notice] = await Promise.all([getCourse(courseId), searchParams]);
  const semester = course.semester_id ? data.semestersById.get(course.semester_id) : null;
  const back = semester ? "/sessions/" + semester.academic_session_id + "/semesters/" + semester.id : "/sessions";
  const parent = semester ? data.sessionsById.get(semester.academic_session_id) : null;

  return <>
    <div className="page-head">
      <Link className="back" href={back}>← {semester?.name ?? "Academics"}</Link>
      <p>{course.code} · {parent && semester ? parent.label + " / " + semester.name : "Standalone"}</p>
      <h1>{course.title}</h1>
      {course.description && <p className="whitespace-pre-wrap">{course.description}</p>}
      {(course.archived_at || parentArchived) && <p className="feedback">{course.archived_at ? "This course is archived." : "This course belongs to an archived semester or session."}</p>}
      {notice.moved === "1" && <p className="feedback" role="status">Course moved with its existing topics and progress.</p>}
      {notice.copied === "1" && <p className="feedback" role="status">Course copied as a new offering.</p>}
      <div className="row">
        <Link className="button" href={"/courses/" + courseId + "/topics"}>View topics</Link>
        <Link className="button secondary" href={"/courses/" + courseId + "/library"}>Course library</Link>
        <Link className="button secondary" href={"/courses/" + courseId + "/notes"}>Course notes</Link>
        <Link className="button secondary" href={"/courses/" + courseId + "/studio"}>AI Study Studio</Link>
        <Link className="button secondary" href={"/courses/" + courseId + "/planner"}>Course planner</Link>
      </div>
    </div>
    <div className="split">
      <section className="panel">
        <h2>Edit course</h2>
        <ActionForm action={saveCourse.bind(null, courseId)}><CourseFields course={course} /><Submit>Save changes</Submit></ActionForm>
        <RecordAction action={archiveCourse.bind(null, courseId)} label={course.archived_at ? "Restore course" : "Archive course"} mode={course.archived_at ? "restore" : "archive"} />
      </section>
      <section className="panel">
        <h2>Move or copy course</h2>
        <p>Moving keeps existing topics and progress. Copying starts a new offering with course details.</p>
        <ActionForm action={transferCourse.bind(null, courseId)}>
          <SemesterPicker semesters={data.activeSemesters} sessions={data.sessionsById} current={course.semester_id ?? undefined} />
          <label>Action<select name="mode" defaultValue="move"><option value="move">Move</option><option value="copy">Copy</option></select></label>
          <Submit>Apply change</Submit>
        </ActionForm>
      </section>
    </div>
  </>;
}
