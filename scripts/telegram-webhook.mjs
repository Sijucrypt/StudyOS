import { botTokenPattern, webhookSecretPattern } from "../src/features/telegram/runtime.mjs";

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
try {
  const url = new URL(process.argv[2]);
  if (!botTokenPattern.test(token ?? "") || !webhookSecretPattern.test(secret ?? "") ||
    url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/api/telegram/webhook") {
    throw new Error("Invalid configuration");
  }
  async function call(method, body) {
    const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10_000), redirect: "error",
    });
    const data = await response.json();
    if (!response.ok || data.ok !== true) throw new Error("Telegram request failed");
    return data.result;
  }
  await call("setWebhook", { url: url.href, secret_token: secret, allowed_updates: ["message"], max_connections: 4 });
  const info = await call("getWebhookInfo", {});
  if (info.url !== url.href) throw new Error("Webhook was not confirmed");
  console.log("Telegram webhook registration verified.");
} catch {
  console.error("Webhook registration failed. Supply the deployed HTTPS /api/telegram/webhook URL and verify the server credentials.");
  process.exitCode = 1;
}
