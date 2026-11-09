import { z } from "zod";

export const MAX_INPUT_TOKENS = 12_000;
export const MAX_OUTPUT_TOKENS = 3_000;

const geminiSchema = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: ["grounded", "insufficient"] },
    title: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          heading: { type: "string" },
          body: { type: "string" },
          citations: { type: "array", items: { type: "string" } },
          options: { type: "array", items: { type: "string" } },
          correctOption: { type: "integer" },
        },
        required: ["heading", "body", "citations", "options", "correctOption"],
      },
    },
  },
  required: ["outcome", "title", "items"],
};

const responseSchema = z.object({
  candidates: z.array(z.object({
    finishReason: z.literal("STOP"),
    content: z.object({ parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() })) }),
  })).length(1),
  usageMetadata: z.object({ totalTokenCount: z.number().int().nonnegative() }).optional(),
});

/** @param {{ model: string, apiKey: string }} provider
 *  @param {{ instructions: string, evidence: { id: string, text: string }[], prompt: string }} input
 *  @param {typeof fetch} fetcher
 */
export async function generateWithGemini(provider, input, fetcher = fetch) {
  const model = "models/" + provider.model;
  const signal = AbortSignal.timeout(25_000);
  const generateContentRequest = {
    systemInstruction: { parts: [{ text: input.instructions }] },
    contents: [{
      role: "user",
      parts: [{ text: JSON.stringify({ request: input.prompt, evidence: input.evidence }) }],
    }],
    generationConfig: {
      candidateCount: 1,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      responseMimeType: "application/json",
      responseJsonSchema: geminiSchema,
    },
  };

  async function request(operation, body) {
    const response = await fetcher("https://generativelanguage.googleapis.com/v1beta/" + model + ":" + operation, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": provider.apiKey },
      body: JSON.stringify(body),
      signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Provider unavailable");
    return response.json();
  }

  const count = z.object({ totalTokens: z.number().int().nonnegative() }).parse(
    await request("countTokens", { generateContentRequest: { model, ...generateContentRequest } }),
  );
  if (count.totalTokens > MAX_INPUT_TOKENS) throw new Error("Provider input exceeds reservation");
  const response = responseSchema.parse(await request("generateContent", generateContentRequest));
  const answer = response.candidates[0].content.parts.filter((part) => !part.thought).map((part) => part.text ?? "").join("");
  if (!answer || answer.length > 60_000) throw new Error("Provider response exceeds limits");
  return { output: JSON.parse(answer), tokens: response.usageMetadata?.totalTokenCount ?? null };
}
