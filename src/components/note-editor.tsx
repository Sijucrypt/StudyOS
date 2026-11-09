"use client";

import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { saveNote } from "@/features/notes/actions";
import { noteExtensions } from "@/features/notes/content";

type Draft = { title: string; body: JSONContent };
const unsavedWarning = "This note has unsaved changes. Leave without saving?";

export function NoteEditor({ courseId, id, title, body, initialRevision }: {
  courseId: string; id: string; title: string; body: JSONContent; initialRevision: number;
}) {
  const [draft, setDraft] = useState<Draft>({ title, body });
  const [committed, setCommitted] = useState(draft);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const revision = useRef(initialRevision);
  const dirty = draft !== committed;

  const editor = useEditor({
    extensions: noteExtensions(),
    content: body,
    immediatelyRender: false,
    editorProps: { attributes: { role: "textbox", "aria-label": "Note content", "aria-multiline": "true", class: "note-content" } },
    onUpdate: ({ editor }) => {
      setDraft((value) => ({ ...value, body: editor.getJSON() }));
      setError("");
    },
  });
  const formatting = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive("bold"),
      italic: editor?.isActive("italic"),
      heading: editor?.isActive("heading", { level: 2 }),
      list: editor?.isActive("bulletList"),
    }),
  });

  const save = useCallback(async () => {
    if (!dirty || conflict || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await saveNote(courseId, id, { ...draft, revision: revision.current });
      if (result.revision) {
        revision.current = result.revision;
        setCommitted(draft);
      } else if (result.conflict) {
        setConflict(true);
      } else {
        setError(result.error ?? "The note could not be saved.");
      }
    } catch {
      setError("The note could not be saved. Check your connection and try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [conflict, courseId, dirty, draft, id]);

  useEffect(() => {
    if (!dirty || saving || conflict || error) return;
    const timer = setTimeout(() => { void save(); }, 700);
    return () => clearTimeout(timer);
  }, [conflict, dirty, error, save, saving]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const guard = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const navigation = event.type === "click" ? event.target.closest("a[href]") : event.target.closest(".site-header form");
      if (navigation && !window.confirm(unsavedWarning)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", guard, true);
    document.addEventListener("submit", guard, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", guard, true);
      document.removeEventListener("submit", guard, true);
    };
  }, [dirty]);

  return <section className="panel" aria-label="Note editor">
    <label>Note title<input value={draft.title} maxLength={160} onChange={(event) => {
      const title = event.target.value;
      setDraft((value) => ({ ...value, title }));
      setError("");
    }} /></label>
    {editor && <div className="row" role="group" aria-label="Formatting">
      <button type="button" className="button secondary" aria-pressed={formatting?.bold} onClick={() => editor.chain().focus().toggleBold().run()}>Bold</button>
      <button type="button" className="button secondary" aria-pressed={formatting?.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>Italic</button>
      <button type="button" className="button secondary" aria-pressed={formatting?.heading} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>Heading</button>
      <button type="button" className="button secondary" aria-pressed={formatting?.list} onClick={() => editor.chain().focus().toggleBulletList().run()}>List</button>
    </div>}
    <EditorContent editor={editor} />
    <div className="row">
      <button className="button" type="button" disabled={!dirty || saving || conflict} onClick={() => void save()}>Save now</button>
      <p role="status">{saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved"}</p>
    </div>
    {error && <p className="feedback error" role="alert">{error}</p>}
    {conflict && <p className="feedback error" role="alert">
      This note changed in another editor or was removed. Your draft is still here. Copy your edits before reloading the saved version.
    </p>}
  </section>;
}
