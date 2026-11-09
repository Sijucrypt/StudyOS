import { z } from "zod";

export const artifactKinds = ["summary", "notes", "flashcards", "mcq", "theory", "guide"] as const;
export const kinds = ["chat", ...artifactKinds] as const;
export type AiKind = typeof kinds[number];

export const kindLabels: Record<AiKind, string> = {
  chat: "Source Q&A",
  summary: "Summary",
  notes: "Study notes",
  flashcards: "Flashcards",
  mcq: "Multiple-choice quiz",
  theory: "Theory practice",
  guide: "Study guide",
};

export const itemSchema = z.object({
  heading: z.string().trim().min(1).max(180),
  body: z.string().trim().min(1).max(1800),
  citations: z.array(z.string().regex(/^S(?:[1-9]|1[0-2])$/)).min(1).max(6),
  options: z.array(z.string().trim().min(1).max(240)).max(4),
  correctOption: z.number().int().min(-1).max(3),
});

export const outputSchema = z.object({
  outcome: z.enum(["grounded", "insufficient"]),
  title: z.string().trim().min(1).max(160),
  items: z.array(itemSchema).max(10),
});

export type AiOutput = z.infer<typeof outputSchema>;

export function validateOutput(value: unknown, kind: AiKind, allowedIds: ReadonlySet<string>): AiOutput | null {
  const parsed = outputSchema.safeParse(value);
  if (!parsed.success) return null;
  const { data } = parsed;
  if (data.outcome === "insufficient") return data.items.length ? null : insufficientEvidence();
  if (!data.items.length) return null;
  for (const item of data.items) {
    if (item.citations.some((id) => !allowedIds.has(id))) return null;
    item.citations = [...new Set(item.citations)];
    if (kind === "mcq") {
      if (item.options.length !== 4 || item.correctOption < 0 ||
        new Set(item.options.map((option) => option.toLowerCase())).size !== 4) return null;
    } else if (item.options.length || item.correctOption !== -1) return null;
  }
  return data;
}

export function insufficientEvidence(): AiOutput {
  return { outcome: "insufficient", title: "Insufficient evidence", items: [] };
}

export function insufficientMessage(kind: AiKind) {
  return kind === "chat"
    ? "I couldn’t find enough evidence in the selected sources to answer this question."
    : "There isn’t enough extracted text in the selected sources for this resource.";
}
