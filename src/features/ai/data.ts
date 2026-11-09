import { notFound } from "next/navigation";
import { authenticated } from "@/lib/auth/server";
import { idSchema } from "@/features/academics/data";
import { type AiKind, validateOutput } from "./contracts";

export type EvidenceRow = {
  material_id: string;
  source_name: string;
  mime_type: string;
  chunk_index: number;
  excerpt: string;
  page_start: number | null;
  page_end: number | null;
};

export type Citation = Omit<EvidenceRow, "excerpt"> & { citation_id: string };
export type AiResult = {
  id: string;
  kind: AiKind;
  question: string | null;
  title: string;
  provider: "fixture" | "gemini" | "local";
  model: string;
  revision: number;
  saved_at: string | null;
};

export async function listAiSources(courseId: string) {
  const { db, user } = await authenticated();
  const rows: { id: string; name: string }[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await db.from("materials").select("id,name")
      .eq("user_id", user.id).eq("course_id", courseId).eq("upload_state", "verified")
      .eq("extraction_state", "ready").is("deleted_at", null)
      .order("name").order("id").range(offset, offset + 199);
    if (error) throw new Error("Could not load sources.");
    rows.push(...data);
    if (data.length < 200) return rows;
  }
}

export async function listAiResults(courseId: string, chat: boolean, page: number) {
  const { db, user } = await authenticated();
  const from = (page - 1) * 20;
  const scoped = db.from("ai_results").select("id,kind,question,title,provider,model,revision,saved_at")
    .eq("user_id", user.id).eq("course_id", courseId);
  const query = chat ? scoped.eq("kind", "chat") : scoped.neq("kind", "chat");
  const { data, error } = await query.order("created_at", { ascending: false }).order("id").range(from, from + 20);
  if (error) throw new Error("Could not load AI results.");
  const rows = data as AiResult[];
  return { rows: rows.slice(0, 20), next: rows.length > 20 };
}

export async function getAiResult(courseId: string, id: string, chat: boolean) {
  const { db, user } = await authenticated();
  if (!idSchema.safeParse(id).success || !idSchema.safeParse(courseId).success) notFound();
  const [result, refs] = await Promise.all([
    db.from("ai_results").select("id,kind,question,title,output,provider,model,revision,saved_at")
      .eq("user_id", user.id).eq("course_id", courseId).eq("id", id).maybeSingle(),
    db.from("ai_result_sources").select("citation_id,material_id,source_name,mime_type,chunk_index,page_start,page_end")
      .eq("user_id", user.id).eq("course_id", courseId).eq("result_id", id).order("citation_id"),
  ]);
  if (result.error || refs.error) throw new Error("Could not open the AI result.");
  if (!result.data || (result.data.kind === "chat") !== chat) notFound();
  const record = result.data as AiResult & { output: unknown };
  const citations = refs.data as Citation[];
  const output = validateOutput(record.output, record.kind, new Set(citations.map((ref) => ref.citation_id)));
  if (!output) throw new Error("This result contains unsupported content.");
  const materialIds = [...new Set(citations.map(({ material_id }) => material_id))];
  const available = new Set<string>();
  if (materialIds.length) {
    const { data, error } = await db.from("materials").select("id")
      .eq("user_id", user.id).eq("course_id", courseId).eq("upload_state", "verified")
      .is("deleted_at", null).in("id", materialIds);
    if (error) throw new Error("Could not verify references.");
    for (const row of data) available.add(row.id);
  }
  return { record, output, citations, available };
}
