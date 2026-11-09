import Link from "next/link";
import { NoteEditor } from "@/components/note-editor";
import { ActionForm } from "@/components/ui/action-form";
import { Submit } from "@/components/ui/submit";
import { removeNote } from "@/features/notes/actions";
import { getNote } from "@/features/notes/data";
import { normalizeNote } from "@/features/notes/content";

export default async function Note({ params }: { params: Promise<{ courseId: string; noteId: string }> }) {
  const { courseId, noteId } = await params;
  const note = await getNote(courseId, noteId);
  const body = normalizeNote(note.body);
  return <>
    <div className="page-head">
      <Link className="back" href={"/courses/" + courseId + "/notes"}>← Course notes</Link>
      <h1>Edit note</h1><p>Changes save automatically.</p>
    </div>
    {body ? <NoteEditor courseId={courseId} id={noteId} title={note.title} body={body} initialRevision={note.revision} />
      : <p role="alert" className="feedback error">This note contains unsupported formatting and could not be opened.</p>}
    <details className="panel">
      <summary>Manage note</summary>
      <ActionForm action={removeNote.bind(null, courseId, noteId)}><Submit variant="secondary">Remove note</Submit></ActionForm>
    </details>
  </>;
}
