import { authenticated } from "@/lib/auth/server";

export type TelegramPreferences = {
  enabled: boolean;
  study_enabled: boolean;
  deadline_enabled: boolean;
  digest_enabled: boolean;
  study_lead: number;
  deadline_lead: number;
  digest_time: string;
  quiet_start: string | null;
  quiet_end: string | null;
};

export type TelegramDelivery = {
  id: string;
  kind: "link" | "test" | "study" | "deadline" | "digest";
  scheduled_for: string;
  next_attempt_at: string;
  status: "pending" | "claimed" | "sending" | "sent" | "failed" | "uncertain" | "suppressed";
  reason: string | null;
  attempts: number;
  sent_at: string | null;
};

export type TelegramState = {
  connected_at: string | null;
  preferences: TelegramPreferences;
  recent: TelegramDelivery[];
};

export async function getTelegramState(): Promise<TelegramState> {
  const { db } = await authenticated();
  const { data, error } = await db.rpc("telegram_state");
  if (error || !data) throw new Error("Telegram settings could not be loaded.");
  return data as TelegramState;
}
