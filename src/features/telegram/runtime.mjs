import { createClient } from "@supabase/supabase-js";

export const botTokenPattern = /^\d+:[A-Za-z0-9_-]{10,}$/;
export const webhookSecretPattern = /^[A-Za-z0-9_-]{16,256}$/;

export function telegramRuntime(env = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_TELEGRAM_SERVICE_KEY;
  if (!url || !key) return null;
  if (env.STUDYOS_TELEGRAM_FIXTURE === "1") {
    if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/?$/.test(url) ||
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY !== "studyos-loopback-fixture" ||
      key !== "studyos-loopback-worker") return null;
    return { mode: "fixture", url, key, endpoint: new URL("/fixture-telegram/sendMessage", url).href };
  }
  const token = env.TELEGRAM_BOT_TOKEN;
  return {
    mode: "live", url, key,
    endpoint: token && botTokenPattern.test(token) ? "https://api.telegram.org/bot" + token + "/sendMessage" : null,
  };
}

export function telegramService(runtime) {
  return createClient(runtime.url, runtime.key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000), cache: "no-store" }) },
  });
}
