"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticated } from "@/lib/auth/server";
import { getCourse, idSchema } from "@/features/academics/data";
import type { FormState } from "@/features/academics/actions";
import { aiProvider } from "./config";
import { getAiResult, type EvidenceRow } from "./data";
import { generate, promptVersion, reservationFor } from "./generate";
import { artifactKinds, insufficientEvidence, insufficientMessage, validateOutput } from "./contracts";

const sourceSelection = z.array(idSchema).min(1).max(6).refine((ids) => new Set(ids).size === ids.length);
const promptText = z.string().trim().max(500);
const providerError = "Study Studio could not complete the request. Your course files and notes are still available.";

export async function runAi(courseId: string, mode: "studio" | "chat", _: FormState, form: FormData): Promise<FormState> {
  const { db, user } = await authenticated();
  if (mode !== "chat" && mode !== "studio") return { error: "Choose a study action." };
  const { course, parentArchived } = await getCourse(courseId);
  if (course.archived_at || parentArchived) return { error: "Restore this course to start a new AI request." };
  const provider = aiProvider();
  if (!provider) return { error: "AI generation is disabled in this workspace." };
  if (form.get("consent") !== provider.kind) return { error: "Review and confirm the source-sharing choice before continuing." };

  const sources = sourceSelection.safeParse(form.getAll("source"));
  if (!sources.success) return { error: "Select one to six different sources with extracted text." };
  const prompt = promptText.safeParse(form.get("prompt") ?? "");
  if (!prompt.success || (mode === "chat" && !prompt.data)) return { error: "Enter a question or instructions of up to 500 characters." };
  const parsedKind = z.enum(artifactKinds).safeParse(form.get("kind"));
  if (mode === "studio" && !parsedKind.success) return { error: "Choose a study resource format." };
  const kind = mode === "chat" ? "chat" : parsedKind.data!;
  const question = kind === "chat" ? prompt.data : null;

  const { data: raw, error: sourceError } = await db.rpc("retrieve_ai_evidence", {
    course_scope: course.id, source_ids: sources.data, question,
  });
  if (sourceError) return { error: "The selected sources could not be read. Refresh and select available files." };
  const evidence = (raw as EvidenceRow[]).map((row, index) => ({ ...row, citation_id: "S" + (index + 1) }));
  if (!evidence.length && kind !== "chat") return { error: insufficientMessage(kind) };
  const ids = new Set(evidence.map((row) => row.citation_id));
  let output = insufficientEvidence();
  let usage: string | null = null;
  let actualTokens: number | null = null;
  const started = Date.now();

  async function log(status: "complete" | "failed", code: "provider" | "invalid_output" | "storage" | null) {
    if (!usage) return;
    await db.from("ai_usage").update({
      status, error_code: code, actual_tokens: actualTokens, latency_ms: Math.max(0, Date.now() - started),
    }).eq("id", usage).eq("user_id", user.id);
  }

  if (evidence.length) {
    const reservation = reservationFor(provider);
    const { data, error } = await db.rpc("reserve_ai_usage", {
      provider_name: provider.kind, model_name: provider.model, operation_name: kind,
      token_reservation: reservation.tokens, cost_reservation: reservation.cost,
      daily_requests: provider.dailyRequests, daily_tokens: provider.dailyTokens, daily_cost: provider.dailyCost,
    });
    if (error) return { error: "AI usage limits could not be checked. Try again later." };
    if (!data) return { error: "The daily AI request, token, or budget limit has been reached. It resets at midnight UTC." };
    usage = data as string;
    let response;
    try {
      response = await generate(provider, kind, prompt.data, evidence.map((row) => ({ id: row.citation_id, text: row.excerpt })));
      actualTokens = response.tokens;
    } catch {
      await log("failed", "provider");
      return { error: providerError };
    }
    const valid = validateOutput(response.output, kind, ids);
    if (!valid) {
      await log("failed", "invalid_output");
      return { error: "The response could not be verified against the selected sources. Try again." };
    }
    output = valid;
  }

  if (output.outcome === "insufficient" && kind !== "chat") {
    await log("complete", null);
    return { error: insufficientMessage(kind) };
  }
  const used = new Set(output.items.flatMap((item) => item.citations));
  const refs = evidence.filter((row) => used.has(row.citation_id)).map((row) => ({
    citation_id: row.citation_id, material_id: row.material_id, chunk_index: row.chunk_index,
    page_start: row.page_start, page_end: row.page_end,
  }));
  const { data: result, error: resultError } = await db.rpc("store_ai_result", {
    course_scope: course.id, output_kind: kind, user_question: question, output_title: output.title,
    output_body: output, source_ids: sources.data, provider_name: usage ? provider.kind : "local",
    model_name: usage ? provider.model : "no-evidence", prompt_id: promptVersion, refs,
  });
  if (resultError || !result) {
    await log("failed", "storage");
    return { error: "The result could not be saved. Check that the selected sources are still available." };
  }
  await log("complete", null);
  const base = "/courses/" + course.id + (mode === "chat" ? "/chat" : "/studio");
  revalidatePath(base);
  redirect(base + (mode === "chat" ? "?result=" : "/") + result);
}

export async function saveAiResource(courseId: string, id: string, _: FormState, form: FormData): Promise<FormState> {
  const { db, user } = await authenticated();
  const { record, output, citations } = await getAiResult(courseId, id, false);
  const revision = z.coerce.number().int().positive().safeParse(form.get("revision"));
  if (!revision.success || revision.data !== record.revision) {
    return { error: "This resource changed in another tab. Reload it before saving." };
  }
  const proposed = {
    ...output,
    title: form.get("title"),
    items: output.items.map((item, index) => ({
      ...item,
      heading: form.get("heading-" + index),
      body: form.get("body-" + index),
      options: item.options.map((_, option) => form.get("option-" + index + "-" + option)),
      correctOption: record.kind === "mcq" ? Number(form.get("correct-" + index)) : -1,
    })),
  };
  const valid = validateOutput(proposed, record.kind, new Set(citations.map((ref) => ref.citation_id)));
  if (!valid) return { error: "Check the title, sections, and any quiz options." };
  const { data, error } = await db.from("ai_results").update({
    title: valid.title, output: valid, saved_at: new Date().toISOString(),
  }).eq("id", id).eq("course_id", courseId).eq("user_id", user.id)
    .eq("revision", revision.data).select("id").maybeSingle();
  if (error || !data) return { error: "The resource could not be saved. Reload it and try again." };
  const path = "/courses/" + courseId + "/studio";
  revalidatePath(path);
  redirect(path + "/" + id + "?saved=1");
}
