import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { Submit } from "@/components/ui/submit";
import { getCourse } from "@/features/academics/data";
import { createNote } from "@/features/notes/actions";
import { listNotes } from "@/features/notes/data";

export default async function Notes({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const { course, parentArchived } = await getCourse(courseId);
  const notes = await listNotes(courseId);
  return <>
    <div className="page-head">
      <Link className="back" href={"/courses/" + courseId}>← {course.code} overview</Link>
      <h1>Notes</h1><p>{course.title}</p>
    </div>
    <section className="panel">
      <h2>Personal notes</h2>
      {!course.archived_at && !parentArchived && <ActionForm action={createNote.bind(null, courseId)}><Submit>New note</Submit></ActionForm>}
      {notes.length ? <ul className="record-list">{notes.map((note) => <li key={note.id}>
        <Link className="record-link" href={"/courses/" + courseId + "/notes/" + note.id}>{note.title}</Link>
      </li>)}</ul> : <p>No notes here yet.</p>}
    </section>
  </>;
}
