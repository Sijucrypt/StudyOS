import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { alice, asUser, asWorker, bob, testDatabase } from "../support/database.mjs";
import { hashLinkToken, matchesWebhookSecret, readTelegramCommand } from "../../src/features/telegram/protocol.ts";
import { deliverTelegram } from "../../src/features/telegram/worker.mjs";
import { localDate, localInput, shiftDay } from "../../src/features/planner/dates.ts";

const defaults = {
  enabled: true, study_enabled: true, deadline_enabled: true, digest_enabled: false,
  study_lead: 15, deadline_lead: 60, digest_time: "07:00", quiet_start: null, quiet_end: null,
};
const minutesFromNow = (minutes) => new Date(Date.now() + minutes * 60_000);
const input = (minutes) => minutesFromNow(minutes).toISOString().slice(0, 16);

async function fixture(t) {
  const db = await testDatabase();
  t.after(() => db.close());
  const user = (owner, sql, params) => asUser(db, owner, (tx) => tx.query(sql, params));
  const service = (sql, params) => asWorker(db, (tx) => tx.query(sql, params));
  const scalar = async (query, sql, params) => (await query(sql + " as result", params)).rows[0].result;
  const asOwner = (owner, sql, params) => scalar((s, p) => user(owner, s, p), sql, params);
  const settings = (owner, op, payload = {}) => asOwner(owner, "select public.telegram_settings_action($1,$2)", [op, JSON.stringify(payload)]);
  const state = (owner) => asOwner(owner, "select public.telegram_state()");
  const webhook = (id, op, chat, hash = null) => scalar(service, "select public.telegram_handle_update($1,$2,$3,$4)", [id, op, chat, hash]);
  const refresh = () => scalar(service, "select public.refresh_telegram_outbox()");
  const claim = () => scalar(service, "select public.claim_telegram_outbox()");
  const prepare = (job) => scalar(service, "select public.prepare_telegram_send($1,$2)", [job.id, job.token]);
  const finish = (job, result, delay = 0) => scalar(service, "select public.finish_telegram_send($1,$2,$3,$4)", [job.id, job.token, result, delay]);
  const schedule = (op, payload) => asOwner(alice, "select public.study_schedule($1,$2)", [op, JSON.stringify(payload)]);
  const beginLink = async (owner) => {
    const digest = hashLinkToken(randomUUID());
    assert.equal(await settings(owner, "link", { token_hash: digest }), "link_created");
    return digest;
  };
  const link = async () => assert.equal(await webhook(100, "start", 900, await beginLink(alice)), true);
  const drainConfirmation = async () => {
    const job = await claim();
    assert.match((await prepare(job)).message, /connected/);
    assert.equal(await finish(job, "sent"), true);
  };
  return { db, user, settings, state, webhook, refresh, claim, prepare, finish, schedule, beginLink, link, drainConfirmation };
}

test("Telegram webhook parsing accepts only private matching senders and validates the shared secret", () => {
  const token = "a".repeat(32);
  const good = { update_id: 123, message: { chat: { id: 777, type: "private" }, from: { id: 777, is_bot: false }, text: "/start@StudyOSFixtureBot " + token } };
  assert.deepEqual(readTelegramCommand(good, "StudyOSFixtureBot"), {
    incoming_id: 123, incoming_chat: 777, command: "start", token_digest: hashLinkToken(token),
  });
  assert.equal(readTelegramCommand(good, "DifferentBot"), null);
  assert.equal(readTelegramCommand({ ...good, message: { ...good.message, chat: { id: 777, type: "group" } } }, "StudyOSFixtureBot"), null);
  assert.equal(readTelegramCommand({ ...good, message: { ...good.message, from: { id: 778, is_bot: false } } }, "StudyOSFixtureBot"), null);
  assert.equal(readTelegramCommand({ ...good, message: { ...good.message, text: "/start invalid" } }, "StudyOSFixtureBot"), null);
  assert.equal(matchesWebhookSecret("studyos-webhook-secret", "studyos-webhook-secret"), true);
  assert.equal(matchesWebhookSecret("studyos-webhook-wrong", "studyos-webhook-secret"), false);
  assert.equal(matchesWebhookSecret(null, "studyos-webhook-secret"), false);
});

test("links are short-lived, single-use, private, and cannot take over another binding", async (t) => {
  const { db, user, state, webhook, settings, beginLink } = await fixture(t);
  const expired = await beginLink(alice);
  await db.query("update public.telegram_link_tokens set expires_at=now()-interval '1 second' where user_id=$1", [alice]);
  assert.equal(await webhook(1, "start", 900, expired), false);
  const previous = await beginLink(alice);
  const code = await beginLink(alice);
  assert.equal(await webhook(2, "start", 900, previous), false);
  await assert.rejects(user(alice, "select public.telegram_handle_update(3,'start',900,$1)", [code]), { code: "42501" });
  assert.equal(await webhook(3, "start", 900, code), true);
  assert.equal(await webhook(3, "start", 900, code), false);
  assert.equal(await webhook(4, "start", 901, code), false);
  const other = await beginLink(bob);
  assert.equal(await webhook(5, "start", 900, other), false);
  assert.equal((await state(bob)).connected_at, null);
  const view = await state(alice);
  assert.ok(view.connected_at);
  assert.equal(view.recent.length, 1);
  assert.equal(view.preferences.enabled, false);
  assert.ok(!JSON.stringify(view).includes("chat_id"));
  for (const table of ["telegram_connections", "telegram_link_tokens", "telegram_outbox", "telegram_preferences"]) {
    await assert.rejects(user(alice, "select * from public." + table), { code: "42501" });
  }
  await assert.rejects(user(null, "select public.telegram_state()"), { code: "42501" });
  await settings(alice, "save", defaults);
  assert.equal(await webhook(6, "stop", 900), true);
  assert.equal(await webhook(6, "stop", 900), false);
  const disconnected = await state(alice);
  assert.equal(disconnected.connected_at, null);
  assert.equal(disconnected.preferences.enabled, false);
  assert.equal(disconnected.recent[0].reason, "unlinked");
});

test("outbox rechecks edits, respects retry-after and fences old worker leases", async (t) => {
  const { db, settings, schedule, link, drainConfirmation, refresh, claim, prepare, finish } = await fixture(t);
  await link();
  await drainConfirmation();
  await settings(alice, "save", defaults);
  const eventId = await schedule("new_event", {
    title: "Old study time", local_time: input(10), timezone: "UTC", duration_minutes: 45, recurrence: "once",
  });
  const first = await claim();
  assert.ok(first);
  assert.equal(await claim(), null);
  const { rows: [occurrence] } = await db.query("select id from public.study_occurrences where event_id=$1", [eventId]);
  await schedule("reschedule", { id: occurrence.id, title: "Updated study time", local_time: input(12), timezone: "UTC", duration_minutes: 45 });
  assert.equal(await prepare(first), null);

  const updated = await claim();
  assert.notEqual(updated.id, first.id);
  assert.match((await prepare(updated)).message, /Updated study time/);
  assert.equal(await prepare(updated), null);
  assert.equal(await finish(updated, "rate_limit", 120), true);
  const retry = (await db.query("select status, next_attempt_at > now() + interval '110 seconds' as delayed from public.telegram_outbox where id=$1", [updated.id])).rows[0];
  assert.deepEqual(retry, { status: "pending", delayed: true });
  await refresh();
  assert.equal(await claim(), null);

  await db.query("update public.telegram_outbox set next_attempt_at=now()-interval '1 second' where id=$1", [updated.id]);
  const lost = await claim();
  await db.query("update public.telegram_outbox set lease_until=now()-interval '1 second' where id=$1", [lost.id]);
  const recovered = await claim();
  assert.equal(recovered.id, lost.id);
  assert.notEqual(recovered.token, lost.token);
  assert.equal(await prepare(lost), null);
  assert.ok(await prepare(recovered));
  assert.equal(await finish(recovered, "sent"), true);
  assert.equal(await finish(recovered, "sent"), false);
  await refresh();
  assert.equal(await claim(), null);

  await schedule("save_deadline", { title: "Soon due", category: "assignment", local_time: input(10), timezone: "UTC" });
  const interrupted = await claim();
  assert.ok(await prepare(interrupted));
  await db.query("update public.telegram_outbox set lease_until=now()-interval '1 second' where id=$1", [interrupted.id]);
  assert.equal(await claim(), null);
  assert.equal((await db.query("select status from public.telegram_outbox where id=$1", [interrupted.id])).rows[0].status, "uncertain");
  assert.equal(await finish(interrupted, "sent"), false);

  const exam = await schedule("save_deadline", { title: "Cancelled exam", category: "exam", local_time: input(15), timezone: "UTC" });
  const queuedExam = await claim();
  await schedule("deadline_status", { id: exam, status: "cancelled" });
  assert.equal(await prepare(queuedExam), null);
  await settings(alice, "save", { ...defaults, enabled: false });
  await schedule("save_deadline", { title: "Disabled reminder", category: "assignment", local_time: input(15), timezone: "UTC" });
  assert.equal(await claim(), null);
});

test("quiet hours defer or suppress delivery, zero lead catches up, and digests use the local day", async (t) => {
  const { db, settings, schedule, link, drainConfirmation, claim, prepare, finish } = await fixture(t);
  await link();
  await drainConfirmation();

  const quiet = await db.query("select studyos_private.telegram_quiet_release($1,'Africa/Lagos','22:00','06:00') as release", ["2026-11-08T22:30:00Z"]);
  assert.equal(new Date(quiet.rows[0].release).toISOString(), "2026-11-09T05:00:00.000Z");
  const near = (minutes) => minutesFromNow(minutes).toISOString().slice(11, 16);
  await db.query("insert into public.profiles(id,timezone) values ($1,'UTC')", [alice]);
  await settings(alice, "save", { ...defaults, quiet_start: near(-1), quiet_end: near(7) });
  const withinQuiet = await schedule("save_deadline", { title: "Quiet deadline", category: "assignment", local_time: input(2), timezone: "UTC" });
  const afterQuiet = await schedule("save_deadline", { title: "After quiet deadline", category: "assignment", local_time: input(10), timezone: "UTC" });
  assert.equal(await claim(), null);
  assert.deepEqual((await db.query("select status, reason from public.telegram_outbox where target_id=$1", [withinQuiet])).rows[0],
    { status: "suppressed", reason: "quiet_hours" });
  assert.deepEqual((await db.query("select status, next_attempt_at > now() as deferred from public.telegram_outbox where target_id=$1", [afterQuiet])).rows[0],
    { status: "pending", deferred: true });
  await schedule("deadline_status", { id: withinQuiet, status: "cancelled" });
  await schedule("deadline_status", { id: afterQuiet, status: "cancelled" });
  await settings(alice, "save", { ...defaults, deadline_lead: 0 });
  await schedule("save_deadline", { title: "At-time alert", category: "other", local_time: input(-1), timezone: "UTC" });
  const atTime = await claim();
  assert.match((await prepare(atTime)).message, /At-time alert/);
  await finish(atTime, "sent");

  const zone = "Pacific/Kiritimati";
  const day = localDate(new Date(), zone);
  await db.query("update public.profiles set timezone=$2 where id=$1", [alice, zone]);
  await schedule("save_deadline", { title: "Today in profile timezone", category: "assignment", local_time: day + "T12:00", timezone: zone });
  await schedule("save_deadline", { title: "Tomorrow in profile timezone", category: "assignment", local_time: shiftDay(day, 1) + "T12:00", timezone: zone });
  await settings(alice, "save", { ...defaults, study_enabled: false, deadline_enabled: false, digest_enabled: true, digest_time: localInput(new Date().toISOString(), zone).slice(11) });
  const digest = await claim();
  const prepared = await prepare(digest);
  assert.match(prepared.message, /Today in profile timezone/);
  assert.doesNotMatch(prepared.message, /Tomorrow in profile timezone/);
  assert.match(prepared.message, /Pacific\/Kiritimati/);
});

test("Telegram transport distinguishes sent, rate-limited, rejected and ambiguous responses", async () => {
  const runtime = { mode: "live", endpoint: "https://example.invalid" };
  const job = { chat_id: "900", message: "Study reminder" };
  const telegram = (status, body) => deliverTelegram(runtime, job, async (_url, init) => {
    assert.equal(JSON.parse(init.body).chat_id, "900");
    assert.equal(JSON.parse(init.body).link_preview_options.is_disabled, true);
    return Response.json(body, { status });
  });
  assert.deepEqual(await telegram(200, { ok: true, result: { message_id: 1 } }), { result: "sent", retry_seconds: 0 });
  assert.deepEqual(await telegram(429, { ok: false, error_code: 429, parameters: { retry_after: 91 } }), { result: "rate_limit", retry_seconds: 91 });
  assert.equal((await telegram(403, { ok: false, error_code: 403 })).result, "telegram_rejected");
  assert.equal((await telegram(503, { ok: false, error_code: 503 })).result, "provider_unavailable");
  assert.equal((await deliverTelegram(runtime, job, async () => new Response("upstream error", { status: 502 }))).result, "delivery_unknown");
  assert.equal((await deliverTelegram(runtime, job, async () => { throw new Error("timeout"); })).result, "delivery_unknown");
});
