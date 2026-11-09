import Link from "next/link";
import { CourseList, PeriodForm, RecordAction } from "@/components/academics";
import { archiveSemester, importHarmattan, saveSemester } from "@/features/academics/actions";
import { getSemester } from "@/features/academics/data";

export default async function SemesterPage({ params, searchParams }: {
  params: Promise<{ sessionId: string; semesterId: string }>; searchParams: Promise<{ imported?: string }>;
}) {
  const { sessionId, semesterId } = await params;
  const [{ data, session, semester }, notice] = await Promise.all([getSemester(sessionId, semesterId), searchParams]);
  const courses = data.courses.filter((course) => course.semester_id === semester.id);
  const archived = Boolean(session.archived_at || semester.archived_at);

  return <>
    <div className="page-head">
      <Link className="back" href="/sessions">← Academics</Link>
      <p>{session.label}</p>
      <h1>{semester.name}</h1>
      {(semester.starts_on || semester.ends_on) && <p>{semester.starts_on ?? "Open start"} – {semester.ends_on ?? "Open end"}</p>}
      {archived && <p className="feedback">This semester or its academic session is archived. Restore it to add courses.</p>}
    </div>
    <div className="split">
      <section className="panel">
        <div className="row spread">
          <h2>Semester courses</h2>
          {!archived && <Link className="button secondary" href={"/courses/new?semester=" + semester.id}>Add course</Link>}
        </div>
        {notice.imported && /^(?:[0-9]|10)$/.test(notice.imported) &&
          <p className="feedback" role="status">{notice.imported} courses added. Existing courses were kept.</p>}
        <CourseList courses={courses} empty="No courses in this semester yet." />
        {!archived && !semester.harmattan_imported_at && <details>
          <summary>Optional UNIOSUN Harmattan import</summary>
          <p>Import the 10 courses in the 400-level template. Existing course codes will be skipped.</p>
          <RecordAction action={importHarmattan.bind(null, sessionId, semesterId)} label="Import Harmattan courses" mode="import" />
        </details>}
      </section>
      <section className="panel">
        <h2>Manage semester</h2>
        <PeriodForm action={saveSemester.bind(null, sessionId, semesterId)} kind="Semester" item={semester} />
        <RecordAction action={archiveSemester.bind(null, sessionId, semesterId)} label={semester.archived_at ? "Restore semester" : "Archive semester"} mode={semester.archived_at ? "restore" : "archive"} />
      </section>
    </div>
  </>;
}
