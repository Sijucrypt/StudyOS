import { getSchema, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

export function noteExtensions() {
  return [StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: false,
  })];
}

export function normalizeNote(value: unknown): JSONContent | null {
  if (!value || typeof value !== "object" || !("type" in value) || value.type !== "doc") return null;
  const pending = [{ value, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const { value: current, depth } = pending.pop()!;
    if (depth > 32 || ++count > 5000) return null;
    if (!current || typeof current !== "object") return null;
    if ("content" in current) {
      if (!Array.isArray(current.content) || current.content.length > 5000) return null;
      for (const child of current.content) pending.push({ value: child, depth: depth + 1 });
    }
  }
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).length > 240_000) return null;
    const document = getSchema(noteExtensions()).nodeFromJSON(value);
    document.check();
    return document.toJSON();
  } catch {
    return null;
  }
}
