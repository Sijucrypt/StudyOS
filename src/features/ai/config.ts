import "server-only";
import { z } from "zod";

const integer = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const liveConfig = z.object({
  model: z.string().regex(/^gemini-[a-z0-9.-]{2,70}$/),
  apiKey: z.string().trim().min(1),
  dailyRequests: integer(1, 1000),
  dailyTokens: integer(1, 2_000_000),
  dailyCost: integer(1, 10_000_000),
  inputRate: integer(1, 1_000_000_000),
  outputRate: integer(1, 1_000_000_000),
});

export function aiProvider() {
  const env = process.env;
  const fixtureUrl = /^http:\/\/127\.0\.0\.1:\d{1,5}\/?$/;
  if (env.STUDYOS_AI_PROVIDER === "fixture" && env.STUDYOS_ENABLE_AI_FIXTURE === "1" &&
    fixtureUrl.test(env.NEXT_PUBLIC_SUPABASE_URL ?? "") &&
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY === "studyos-loopback-fixture") {
    return { kind: "fixture" as const, model: "local-excerpt-fixture", dailyRequests: 12, dailyTokens: 180_000, dailyCost: 0 };
  }
  if (env.STUDYOS_AI_PROVIDER !== "gemini" || env.STUDYOS_GEMINI_APPROVED !== "1") return null;
  const parsed = liveConfig.safeParse({
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL,
    dailyRequests: env.AI_DAILY_REQUEST_LIMIT,
    dailyTokens: env.AI_DAILY_TOKEN_LIMIT,
    dailyCost: env.AI_DAILY_COST_MICROUSD,
    inputRate: env.GEMINI_INPUT_USD_PER_MILLION_MICRO,
    outputRate: env.GEMINI_OUTPUT_USD_PER_MILLION_MICRO,
  });
  return parsed.success ? { kind: "gemini" as const, ...parsed.data } : null;
}
