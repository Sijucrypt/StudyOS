import type { JSONContent } from "@tiptap/core";

function escapeText(text: string) {
  // Markdown punctuation and raw HTML must stay literal.
  return text.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]!)
    .replace(/[\\`*_{}\[\]()#+.!|~\-]/g, "\\$&");
}

function fence(text: string, minimum: number) {
  let length = minimum;
  for (const match of text.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  return "`".repeat(length);
}

function inline(node: JSONContent): string {
  if (node.type === "hardBreak") return "  \n";
  const text = (node.text ?? "").replace(/\r?\n|\r/g, " ");
  if (node.marks?.some((mark) => mark.type === "code") && text.trim()) {
    const delimiter = fence(text, 1);
    const pad = /^[` ]|[` ]$/.test(text) ? " " : "";
    return delimiter + pad + text + pad + delimiter;
  }

  const parts = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  if (!parts?.[2]) return escapeText(text);
  let result = escapeText(parts[2]);
  for (const mark of node.marks ?? []) {
    const delimiter = { bold: "**", italic: "_", strike: "~~" }[mark.type];
    if (delimiter) result = delimiter + result + delimiter;
  }
  return parts[1] + result + parts[3];
}

function blocks(nodes: JSONContent[] = []): string {
  return nodes.map(block).join("\n\n");
}

function block(node: JSONContent): string {
  switch (node.type) {
    case "paragraph":
      return (node.content ?? []).map(inline).join("");
    case "heading": {
      const level = node.attrs?.level;
      return "#".repeat(level === 2 || level === 3 ? level : 1) + " " + (node.content ?? []).map(inline).join("");
    }
    case "blockquote":
      return blocks(node.content).split("\n").map((line) => line ? "> " + line : ">").join("\n");
    case "codeBlock": {
      const text = (node.content ?? []).map((child) => child.text ?? "").join("");
      const delimiter = fence(text, 3);
      return delimiter + "\n" + text + "\n" + delimiter;
    }
    case "bulletList":
    case "orderedList": {
      const start = node.attrs?.start;
      const first = typeof start === "number" && Number.isSafeInteger(start) && start >= 0 && start <= 999_995_000 ? start : 1;
      return (node.content ?? []).map((item, index) => {
        const prefix = node.type === "orderedList" ? (first + index) + ". " : "- ";
        const [line, ...rest] = blocks(item.content).split("\n");
        return [prefix + line, ...rest.map((entry) => entry ? " ".repeat(prefix.length) + entry : "")].join("\n");
      }).join("\n");
    }
    case "horizontalRule":
      return "---";
    default:
      return "";
  }
}

export function noteMarkdown(title: string, body: JSONContent) {
  const content = blocks(body.content);
  return "# " + escapeText(title.replace(/\s+/g, " ").trim()) + "\n" + (content ? "\n" + content + "\n" : "");
}

export function noteFilename(title: string, format: "md" | "json") {
  const slug = title.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-").slice(0, 80).replace(/^-|-$/g, "");
  // Avoid reserved Windows device names, even with an extension.
  const basename = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(slug) ? "note-" + slug : slug;
  return (basename || "studyos-note") + "." + format;
}
