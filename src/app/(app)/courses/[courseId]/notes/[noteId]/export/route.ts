import { getNote } from "@/features/notes/data";
import { normalizeNote } from "@/features/notes/content";
import { noteFilename, noteMarkdown } from "@/features/notes/export";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: Request, { params }: { params: Promise<{ courseId: string; noteId: string }> }) {
  const { courseId, noteId } = await params;
  const note = await getNote(courseId, noteId);
  const format = new URL(request.url).searchParams.get("format");
  if (format !== "md" && format !== "json") {
    return new Response("Choose Markdown or JSON.", { status: 400, headers: privateHeaders });
  }
  const body = normalizeNote(note.body);
  if (!body) {
    return new Response("This note contains unsupported formatting.", { status: 422, headers: privateHeaders });
  }
  const content = format === "md" ? noteMarkdown(note.title, body) : JSON.stringify({
    schemaVersion: 1, id: note.id, courseId, title: note.title, revision: note.revision, body,
  }, null, 2) + "\n";
  return new Response(content, {
    headers: {
      ...privateHeaders,
      "Content-Type": (format === "md" ? "text/markdown" : "application/json") + "; charset=utf-8",
      "Content-Disposition": 'attachment; filename="' + noteFilename(note.title, format) + '"',
    },
  });
}
