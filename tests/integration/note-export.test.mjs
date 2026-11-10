import assert from "node:assert/strict";
import { test } from "node:test";
import { noteFilename, noteMarkdown } from "../../src/features/notes/export.ts";

test("Markdown exports rich text while keeping user text and code fences literal", () => {
  const doc = { type: "doc", content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Examples" }] },
    { type: "paragraph", content: [
      { type: "text", text: "<em>literal</em> " },
      { type: "text", text: "bold", marks: [{ type: "bold" }] },
      { type: "hardBreak" },
      { type: "text", text: "a`b", marks: [{ type: "code" }] },
    ] },
    { type: "orderedList", attrs: { start: 4 }, content: [
      { type: "listItem", content: [
        { type: "paragraph", content: [{ type: "text", text: "List item" }] },
        { type: "codeBlock", content: [{ type: "text", text: "```\ncode" }] },
      ] },
    ] },
  ] };
  assert.equal(noteMarkdown("Safety\n# notes", doc), [
    "# Safety \\# notes", "", "## Examples", "",
    "&lt;em&gt;literal&lt;/em&gt; **bold**  ", "``a`b``", "",
    "4. List item", "", "   ````", "   ```", "   code", "   ````", "",
  ].join("\n"));
});

test("note filenames avoid header injection, device names and empty slugs", () => {
  assert.equal(noteFilename("Résumé\r\n #1", "md"), "resume-1.md");
  assert.equal(noteFilename("CON", "json"), "note-con.json");
  assert.equal(noteFilename("📚", "md"), "studyos-note.md");
});
