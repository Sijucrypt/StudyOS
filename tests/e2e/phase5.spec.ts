import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { devices, expect, test, type Page } from "@playwright/test";
import { localInput } from "../../src/features/planner/dates";

const fixtureUrl = "http://127.0.0.1:54339";
const workerKey = "studyos-loopback-worker";
const integration = "/settings/integrations/telegram";
const secret = "studyos-loopback-webhook";
const run = promisify(execFile);

function workerTick() {
  return run(process.execPath, ["scripts/telegram-worker.mjs", "--once"], {
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: fixtureUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "studyos-loopback-fixture",
      SUPABASE_TELEGRAM_SERVICE_KEY: workerKey,
      STUDYOS_TELEGRAM_FIXTURE: "1",
    },
    timeout: 45_000,
  });
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("alice@studyos.test");
  await page.getByLabel("Password").fill("local-fixture-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("verified Telegram linking and browser-independent dispatch with duplicate and unlink protection", async ({ browser, request, baseURL }, info) => {
  test.setTimeout(120_000);
  const chat = info.project.name === "desktop" ? 9101 : 9102;
  const updateId = chat * 100;
  const prefix = info.project.name + " reminder";
  const deliveries = async () => {
    const response = await request.get(fixtureUrl + "/fixture-telegram/deliveries", {
      headers: { "x-studyos-fixture-key": workerKey },
    });
    expect(response.ok()).toBeTruthy();
    const rows = await response.json() as { chat_id: string; text: string }[];
    return rows.filter((row) => row.chat_id === String(chat)).map((row) => row.text);
  };

  const viewport = info.project.name === "phone" ? { ...devices["Pixel 7"], viewport: { width: 320, height: 740 }, baseURL } : { baseURL };
  let context = await browser.newContext(viewport);
  try {
    let page = await context.newPage();
    await signIn(page);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("link", { name: "Telegram reminders", exact: true }).click();
    await expect(page.getByText("Connections and deliveries use a simulated Telegram bot.", { exact: false })).toBeVisible();
    await expect(page.getByText("Telegram disconnected", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Create Telegram link" }).click();
    const code = page.getByLabel("Demo link code");
    await expect(code).toHaveText(/^[A-Za-z0-9_-]{32}$/);
    const token = await code.textContent();
    const update = {
      update_id: updateId, message: { text: "/start " + token, chat: { id: chat, type: "private" }, from: { id: chat, is_bot: false } },
    };
    expect((await request.post("/api/telegram/webhook", { data: update, headers: { "x-telegram-bot-api-secret-token": "forged" } })).status()).toBe(401);
    const valid = { "x-telegram-bot-api-secret-token": secret };
    expect((await request.post("/api/telegram/webhook", {
      headers: valid, data: { ...update, message: { ...update.message, chat: { id: chat, type: "group" } } },
    })).status()).toBe(204);
    await page.getByRole("button", { name: "Refresh status" }).click();
    await expect(page.getByText("Telegram disconnected", { exact: true })).toBeVisible();
    for (let i = 0; i < 2; i++) {
      expect((await request.post("/api/telegram/webhook", { headers: valid, data: update })).status()).toBe(204);
    }
    await page.getByRole("button", { name: "Refresh status" }).click();
    await expect(page.getByText("Telegram connected", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Send test message" }).click();
    await expect(page.getByText("Test message queued.", { exact: true })).toBeVisible();
    await page.getByLabel("Enable scheduled reminders").check();
    await page.getByLabel("Study lead time (minutes)").fill("30");
    await page.getByRole("button", { name: "Save reminder preferences" }).click();
    await expect(page.getByText("Reminder preferences saved.", { exact: true })).toBeVisible();

    async function schedule(title: string, type: "study" | "deadline") {
      await page.goto("/planner?view=day");
      const at = localInput(new Date(Date.now() + 10 * 60_000).toISOString(), "Africa/Lagos");
      if (type === "study") {
        await page.getByLabel("Session title").fill(title);
        await page.getByLabel("Starts (Africa/Lagos)").fill(at);
        await page.getByRole("button", { name: "Add study session" }).click();
      } else {
        await page.getByLabel("Deadline title").fill(title);
        await page.getByLabel("Due (Africa/Lagos)").fill(at);
        await page.getByRole("button", { name: "Add deadline", exact: true }).click();
      }
      await expect(page.getByText(title, { exact: true })).toBeVisible();
    }

    await schedule(prefix + " session", "study");
    await schedule(prefix + " assignment", "deadline");
    await schedule(prefix + " cancelled", "deadline");
    const cancelled = page.locator(".planner-agenda-day li").filter({ hasText: prefix + " cancelled" });
    await cancelled.getByText("Deadline actions").click();
    await cancelled.getByRole("button", { name: "Cancel deadline" }).click();
    await expect(cancelled.getByText("Cancelled", { exact: true })).toBeVisible();
    expect(await deliveries()).toEqual([]);

    await context.close();
    await Promise.all([workerTick(), workerTick()]);
    const messages = await deliveries();
    expect(messages.filter((item) => item.includes("StudyOS is connected"))).toHaveLength(1);
    expect(messages.filter((item) => item.includes("test message from StudyOS"))).toHaveLength(1);
    expect(messages.filter((item) => item.includes(prefix + " session"))).toHaveLength(1);
    expect(messages.filter((item) => item.includes(prefix + " assignment"))).toHaveLength(1);
    expect(messages.some((item) => item.includes(prefix + " cancelled"))).toBe(false);

    context = await browser.newContext(viewport);
    page = await context.newPage();
    await signIn(page);
    await page.goto(integration);
    await expect(page.getByText("Sent", { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
    await page.getByLabel("Enable scheduled reminders").uncheck();
    await page.getByRole("button", { name: "Save reminder preferences" }).click();
    await expect(page.getByText("Reminder preferences saved.", { exact: true })).toBeVisible();
    await schedule(prefix + " muted", "study");
    await workerTick();
    expect(await deliveries()).toEqual(messages);
    await page.goto(integration);
    await page.getByLabel("Enable scheduled reminders").check();
    await page.getByRole("button", { name: "Save reminder preferences" }).click();
    await expect(page.getByText("Reminder preferences saved.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Unlink Telegram" }).click();
    await expect(page.getByText("Telegram disconnected", { exact: true })).toBeVisible();
    await context.close();
    await workerTick();
    expect(await deliveries()).toEqual(messages);
  } finally {
    await context.close().catch(() => {});
  }
});
