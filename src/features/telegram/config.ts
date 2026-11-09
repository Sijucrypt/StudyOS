import "server-only";

import { telegramRuntime, webhookSecretPattern } from "./runtime.mjs";

export function telegramConfig() {
  const runtime = telegramRuntime();
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const username = runtime?.mode === "fixture" ? "StudyOSFixtureBot" : process.env.TELEGRAM_BOT_USERNAME;
  if (!runtime || !secret || !webhookSecretPattern.test(secret) || !username || !/^[A-Za-z][A-Za-z0-9_]{1,28}bot$/i.test(username)) {
    return null;
  }
  return { runtime, secret, username };
}
