import type { Metadata } from "next";
import Link from "next/link";
import { RefreshTelegramStatus, TelegramLinkControl } from "@/components/telegram-link-control";
import { ActionForm } from "@/components/ui/action-form";
import { Submit } from "@/components/ui/submit";
import { getProfile } from "@/features/academics/data";
import { instantLabel } from "@/features/planner/dates";
import { requestTelegramTest, saveTelegramPreferences, unlinkTelegram } from "@/features/telegram/actions";
import { telegramConfig } from "@/features/telegram/config";
import { getTelegramState, type TelegramDelivery } from "@/features/telegram/data";

export const metadata: Metadata = { title: "Telegram reminders" };

const deliveryLabel: Record<TelegramDelivery["kind"], string> = {
  link: "Connection confirmation", test: "Test message", study: "Study reminder", deadline: "Deadline reminder", digest: "Daily digest",
};
const statusLabel: Record<TelegramDelivery["status"], string> = {
  pending: "Queued", claimed: "Checking schedule", sending: "Sending", sent: "Sent",
  failed: "Failed", uncertain: "Delivery unknown", suppressed: "Skipped",
};
const reasons: Record<string, string> = {
  changed: "The scheduled item changed.",
  disabled: "This reminder type was disabled.",
  unlinked: "The Telegram connection was removed.",
  quiet_hours: "Quiet hours lasted through the delivery window.",
  expired: "The delivery window expired.",
  rate_limit: "Telegram requested a delay.",
  provider_unavailable: "Telegram returned a temporary error.",
  telegram_rejected: "Telegram rejected the message. Check that the bot is allowed to message you.",
  delivery_unknown: "The delivery could not be confirmed.",
};

export default async function TelegramSettings() {
  const config = telegramConfig();
  const [state, { timezone }] = await Promise.all([getTelegramState(), getProfile()]);
  const connected = Boolean(state.connected_at);
  const p = state.preferences;

  return <>
    <header className="page-head">
      <Link className="back" href="/settings">← Settings</Link>
      <h1>Telegram reminders</h1>
      <p>Get study session, deadline, and daily digest notifications through the linked Telegram bot.</p>
    </header>
    {!config && <p className="feedback">Telegram setup is required on this instance. See the setup steps in the project README.</p>}
    {config?.runtime.mode === "fixture" && <p className="feedback">Local demo. Connections and deliveries use a simulated Telegram bot.</p>}
    <div className="split">
      <section className="panel" aria-labelledby="telegram-connection">
        <h2 id="telegram-connection">Connection</h2>
        <p><strong>{connected ? "Telegram connected" : "Telegram disconnected"}</strong></p>
        {state.connected_at && <p>Verified {instantLabel(state.connected_at, timezone, true)}</p>}
        {config && <TelegramLinkControl key={state.connected_at ?? "disconnected"} connected={connected} />}
        <div className="row">
          <RefreshTelegramStatus />
          {connected && config && <ActionForm action={requestTelegramTest}><Submit variant="secondary">Send test message</Submit></ActionForm>}
          {connected && <ActionForm action={unlinkTelegram}><Submit variant="secondary">Unlink Telegram</Submit></ActionForm>}
        </div>
      </section>
      {config && <section className="panel" aria-labelledby="telegram-preferences">
        <h2 id="telegram-preferences">Reminder preferences</h2>
        <p>Times use {timezone}. Quiet hours apply to scheduled reminders and the daily digest.</p>
        <ActionForm action={saveTelegramPreferences}>
          <label className="reminder-toggle"><input type="checkbox" name="enabled" defaultChecked={p.enabled} /> Enable scheduled reminders</label>
          <label className="reminder-toggle"><input type="checkbox" name="study_enabled" defaultChecked={p.study_enabled} /> Study sessions</label>
          <label>Study lead time (minutes)<input type="number" name="study_lead" min={0} max={1440} defaultValue={p.study_lead} required /></label>
          <label className="reminder-toggle"><input type="checkbox" name="deadline_enabled" defaultChecked={p.deadline_enabled} /> Deadlines</label>
          <label>Deadline lead time (minutes)<input type="number" name="deadline_lead" min={0} max={1440} defaultValue={p.deadline_lead} required /></label>
          <label className="reminder-toggle"><input type="checkbox" name="digest_enabled" defaultChecked={p.digest_enabled} /> Daily digest</label>
          <label>Daily digest time<input type="time" name="digest_time" defaultValue={p.digest_time.slice(0, 5)} required /></label>
          <div className="fields">
            <label>Quiet hours start<input type="time" name="quiet_start" defaultValue={p.quiet_start?.slice(0, 5)} /></label>
            <label>Quiet hours end<input type="time" name="quiet_end" defaultValue={p.quiet_end?.slice(0, 5)} /></label>
          </div>
          <p>Set the lead time to 0 for an alert at the start or due time. Leave both quiet-hour fields empty to deliver at any hour.</p>
          <Submit>Save reminder preferences</Submit>
        </ActionForm>
      </section>}
    </div>
    <section className="panel" aria-labelledby="telegram-deliveries">
      <h2 id="telegram-deliveries">Recent deliveries</h2>
      {state.recent.length ? <ul className="record-list">{state.recent.map((entry) => <li className="stack" key={entry.id}>
        <div className="row spread"><strong>{deliveryLabel[entry.kind]}</strong><span className="tag">{statusLabel[entry.status]}</span></div>
        <p>{entry.sent_at ? "Sent " + instantLabel(entry.sent_at, timezone, true)
          : "Scheduled " + instantLabel(entry.scheduled_for, timezone, true)}
          {entry.attempts > 0 && " · " + entry.attempts + (entry.attempts === 1 ? " attempt" : " attempts")}</p>
        {entry.reason && reasons[entry.reason] && <p>{reasons[entry.reason]}</p>}
        {entry.status === "pending" && entry.attempts > 0 && <p>Next attempt {instantLabel(entry.next_attempt_at, timezone, true)}</p>}
      </li>)}</ul> : <p>No deliveries yet.</p>}
    </section>
  </>;
}
