import type { Metadata } from "next";
import Link from "next/link";
import { CourseList, PeriodForm, RecordAction } from "@/components/academics";
import { archiveSession, saveSemester, saveSession } from "@/features/academics/actions";
import { academics } from "@/features/academics/data";

export const metadata: Metadata = { title: "Academics" };

export default async function Sessions() {
  const { sessions, semesters, courses } = await academics();
  const standalone = courses.filter((course) => !course.semester_id);
  return <>
    <div className="page-head">
      <h1>Academics</h1>
      <p>Create a session and add semesters, or keep independent learning in standalone courses.</p>
    </div>
    <div className="split">
      <section className="panel"><h2>New academic session</h2><PeriodForm kind="Session" action={saveSession.bind(null, null)} /></section>
      <section className="panel">
        <div className="row spread"><h2>Standalone courses</h2><Link className="button secondary" href="/courses/new">Add course</Link></div>
        <CourseList courses={standalone} empty="No standalone courses yet." />
      </section>
    </div>
    <section className="stack" aria-label="Academic sessions">
      <h2>Academic sessions</h2>
      {sessions.length === 0 && <p>No academic sessions yet.</p>}
      {sessions.map((session) => {
        const items = semesters.filter((semester) => semester.academic_session_id === session.id);
        return <article className="panel" key={session.id}>
          <div className="row spread"><h3>{session.label}</h3>{session.archived_at && <span className="tag">Archived</span>}</div>
          {(session.starts_on || session.ends_on) && <p>{session.starts_on ?? "Open start"} – {session.ends_on ?? "Open end"}</p>}
          {items.length ? <ul className="record-list">
            {items.map((item) => <li key={item.id} className="row">
              <Link className="record-link" href={"/sessions/" + session.id + "/semesters/" + item.id}>{item.name}</Link>
              {item.archived_at && <span className="tag">Archived</span>}
            </li>)}
          </ul> : <p>No semesters yet.</p>}
          {!session.archived_at && <details><summary>Add semester</summary><PeriodForm kind="Semester" action={saveSemester.bind(null, session.id, null)} /></details>}
          <details><summary>Manage session</summary><div className="stack">
            <PeriodForm kind="Session" item={session} action={saveSession.bind(null, session.id)} />
            <RecordAction action={archiveSession.bind(null, session.id)} label={session.archived_at ? "Restore session" : "Archive session"} mode={session.archived_at ? "restore" : "archive"} />
          </div></details>
        </article>;
      })}
    </section>
  </>;
}
