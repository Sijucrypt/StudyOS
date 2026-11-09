"use server";

import { randomBytes, randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authenticated } from "@/lib/auth/server";
import type { FormState } from "@/features/academics/actions";
import { telegramConfig } from "./config";
import { hashLinkToken } from "./protocol";
import { telegramService } from "./runtime.mjs";

const page = "/settings/integrations/telegram";
const unavailable = "Telegram delivery is unavailable until the bot is configured.";
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const lead = z.coerce.number().int().min(0).max(1440);
const preferences = z.object({
  enabled: z.boolean(),
  study_enabled: z.boolean(),
  deadline_enabled: z.boolean(),
  digest_enabled: z.boolean(),
  study_lead: lead,
  deadline_lead: lead,
  digest_time: time,
  quiet_start: time.nullable(),
  quiet_end: time.nullable(),
}).refine(({ quiet_start, quiet_end }) => (!quiet_start && !quiet_end) || Boolean(quiet_start && quiet_end && quiet_start !== quiet_end));

export type LinkState = FormState & { link?: string; demoCode?: string };

export async function createTelegramLink(): Promise<LinkState> {
  const { db } = await authenticated();
  const config = telegramConfig();
  if (!config) return { error: unavailable };
  const token = randomBytes(24).toString("base64url");
  const { error } = await db.rpc("telegram_settings_action", { operation: "link", payload: { token_hash: hashLinkToken(token) } });
  if (error) return { error: "Could not create a Telegram link. Try again." };
  return config.runtime.mode === "fixture" ? { demoCode: token } : { link: "https://t.me/" + config.username + "?start=" + token };
}

export async function simulateTelegramLink(code: string): Promise<FormState> {
  const { user } = await authenticated();
  const config = telegramConfig();
  if (!config || config.runtime.mode !== "fixture" || !/^[A-Za-z0-9_-]{32}$/.test(code)) return { error: unavailable };
  const { data, error } = await telegramService(config.runtime).rpc("telegram_handle_update", {
    incoming_id: randomInt(1, 2 ** 47),
    command: "start",
    incoming_chat: Number.parseInt(hashLinkToken(user.id).slice(0, 12), 16) + 1,
    token_digest: hashLinkToken(code),
  });
  if (error || !data) return { error: "The demo code is invalid or expired. Create a new one." };
  revalidatePath(page);
  return { success: "Demo connection verified." };
}

export async function saveTelegramPreferences(_: FormState, form: FormData): Promise<FormState> {
  const { db } = await authenticated();
  if (!telegramConfig()) return { error: unavailable };
  const values = preferences.safeParse({
    enabled: form.get("enabled") === "on",
    study_enabled: form.get("study_enabled") === "on",
    deadline_enabled: form.get("deadline_enabled") === "on",
    digest_enabled: form.get("digest_enabled") === "on",
    study_lead: form.get("study_lead") || undefined,
    deadline_lead: form.get("deadline_lead") || undefined,
    digest_time: form.get("digest_time"),
    quiet_start: form.get("quiet_start") || null,
    quiet_end: form.get("quiet_end") || null,
  });
  if (!values.success) return { error: "Use lead times from 0 to 1,440 minutes and enter both quiet hours, or leave both blank." };
  const { error } = await db.rpc("telegram_settings_action", { operation: "save", payload: values.data });
  if (error) return { error: "Could not save Telegram preferences. Try again." };
  revalidatePath(page);
  return { success: "Reminder preferences saved." };
}

export async function requestTelegramTest(): Promise<FormState> {
  const { db } = await authenticated();
  if (!telegramConfig()) return { error: unavailable };
  const { data, error } = await db.rpc("telegram_settings_action", { operation: "test", payload: {} });
  if (error || !data) return { error: "Could not queue the test message." };
  if (data === "not_connected") return { error: "Connect Telegram first." };
  revalidatePath(page);
  return { success: data === "already_queued" ? "A test was queued recently. Wait a minute before trying again." : "Test message queued." };
}

export async function unlinkTelegram(): Promise<FormState> {
  const { db } = await authenticated();
  const { error } = await db.rpc("telegram_settings_action", { operation: "unlink", payload: {} });
  if (error) return { error: "Could not unlink Telegram. Try again." };
  revalidatePath(page);
  return { success: "Telegram disconnected." };
}
