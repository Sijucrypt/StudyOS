import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { calendarWindow, localDate, localInput, shiftDay, weekStart } from "../../src/features/planner/dates.ts";
import { alice, asUser, bob, testDatabase } from "../support/database.mjs";

async function fixture(t) {
  const db = await testDatabase();
  t.after(() => db.close());
  const query = (user, sql, params) => asUser(db, user, (tx) => tx.query(sql, params));
  const scalar = async (user, sql, params) => (await query(user, sql + " as result", params)).rows[0].result;
  const schedule = (user, operation, payload) => scalar(user, "select public.study_schedule($1,$2)", [operation, JSON.stringify(payload)]);
  const timer = (user, operation, payload = {}) => scalar(user, "select public.study_timer($1,$2)", [operation, JSON.stringify(payload)]);
  const window = (user, first, last, zone, course = null) => scalar(user, "select public.study_window($1,$2,$3,$4)", [first, last, zone, course]);
  const report = (user, first, last, zone, course = null) => scalar(user, "select public.study_metrics($1,$2,$3,$4)", [first, last, zone, course]);
  const course = async (user) => (await query(user, "insert into public.courses(code,title) values ('P','Planner') returning id")).rows[0].id;
  return { db, query, schedule, timer, window, report, course };
}

const event = (local_time, extra = {}) => ({
  local_time, title: "Study session", timezone: "Africa/Lagos", duration_minutes: 45, recurrence: "once", ...extra,
});
const iso = (time) => new Date(time).toISOString();
const ref = (snapshot) => ({ id: snapshot.log.id, revision: snapshot.log.revision });

test("calendar navigation and profile-local date conversion handle leap dates and midnight", () => {
  assert.equal(shiftDay("2028-02-28", 1), "2028-02-29");
  assert.equal(weekStart("2026-11-08"), "2026-11-02");
  assert.deepEqual(calendarWindow("2026-12-31", "month"), {
    first: "2026-12-01", last: "2026-12-31", previous: "2026-11-01", next: "2027-01-01",
  });
  const midnight = "2026-11-08T23:10:00.000Z";
  assert.equal(localDate(new Date(midnight), "Africa/Lagos"), "2026-11-09");
  assert.equal(localInput(midnight, "Africa/Lagos"), "2026-11-09T00:10");
});

test("planner preserves local recurrence through DST and stable IDs through cancellation, rescheduling, and series replacement", async (t) => {
  const { schedule, window, query, course } = await fixture(t);
  const courseId = await course(alice);
  const bobsCourse = await course(bob);
  const ownTopic = (await query(alice, "insert into public.topics(course_id,title) values ($1,'Spring review') returning id", [courseId])).rows[0].id;
  const foreignTopic = (await query(bob, "insert into public.topics(course_id,title) values ($1,'Other review') returning id", [bobsCourse])).rows[0].id;
  await assert.rejects(schedule(bob, "new_event", event("2026-03-07T02:30", { course_id: courseId })), { code: "42501" });
  await assert.rejects(schedule(alice, "new_event", event("2026-03-07T02:30", { course_id: courseId, topic_id: foreignTopic })), { code: "42501" });
  await assert.rejects(window(bob, "2026-03-07", "2026-03-10", "UTC", courseId), { code: "42501" });
  const spring = await schedule(alice, "new_event", event("2026-03-07T02:30", {
    recurrence: "daily", repeat_until: "2026-03-09", timezone: "America/New_York", course_id: courseId, topic_id: ownTopic,
  }));
  const springView = await window(alice, "2026-03-07", "2026-03-10", "America/New_York", courseId);
  assert.deepEqual(springView.occurrences.map((o) => iso(o.starts_at)), [
    "2026-03-07T07:30:00.000Z", "2026-03-08T07:30:00.000Z", "2026-03-09T06:30:00.000Z",
  ]);
  assert.ok(springView.occurrences.every((o) => o.event_id === spring));
  assert.ok(springView.occurrences.every((o) => o.topic_id === ownTopic && o.topic_title === "Spring review"));
  assert.equal((await window(alice, "2026-03-08", "2026-03-08", "UTC")).occurrences[0].id, springView.occurrences[1].id);
  assert.equal((await window(alice, "2026-03-08", "2026-03-08", "america/new_york")).occurrences[0].id, springView.occurrences[1].id);
  await schedule(alice, "new_event", event("2026-11-01T01:30", { timezone: "America/New_York" }));
  assert.equal(iso((await window(alice, "2026-11-01", "2026-11-01", "America/New_York")).occurrences[0].starts_at),
    "2026-11-01T06:30:00.000Z");

  const series = await schedule(alice, "new_event", event("2099-02-01T09:00", { recurrence: "weekly", course_id: courseId }));
  const future = (await window(alice, "2099-02-01", "2099-02-23", "Africa/Lagos")).occurrences;
  assert.deepEqual(future.map((o) => o.local_date), ["2099-02-01", "2099-02-08", "2099-02-15", "2099-02-22"]);
  await assert.rejects(schedule(bob, "cancel_occurrence", { id: future[0].id }), { code: "42501" });
  await schedule(alice, "cancel_occurrence", { id: future[0].id });
  await schedule(alice, "reschedule", event("2099-02-09T10:15", { id: future[1].id, course_id: courseId }));
  const reread = (await window(alice, "2099-02-01", "2099-02-23", "Africa/Lagos")).occurrences;
  assert.equal(reread[0].status, "cancelled");
  assert.equal(reread[1].id, future[1].id);
  assert.equal(reread[1].local_date, "2099-02-08");
  assert.equal(iso(reread[1].starts_at), "2099-02-09T09:15:00.000Z");
  assert.equal((await window(bob, "2099-02-01", "2099-02-23", "Africa/Lagos", bobsCourse)).occurrences.length, 0);
  const replacement = await schedule(alice, "replace_series", event("2099-02-15T14:00", { id: future[2].id, course_id: courseId, recurrence: "weekly" }));
  const newView = (await window(alice, "2099-02-01", "2099-02-23", "Africa/Lagos")).occurrences;
  assert.deepEqual(newView.map((o) => o.event_id), [series, replacement, replacement]);
  await schedule(alice, "cancel_series", { id: newView[1].id });
  assert.ok((await window(alice, "2099-02-01", "2099-02-23", "Africa/Lagos")).occurrences.every((o) => o.status === "cancelled"));

  const historicSeries = await schedule(alice, "new_event", event("2026-01-01T10:00", { recurrence: "daily" }));
  const historic = (await window(alice, "2026-01-01", "2026-01-01", "Africa/Lagos")).occurrences[0];
  const upcoming = (await window(alice, "2099-03-01", "2099-03-01", "Africa/Lagos")).occurrences.find((o) => o.event_id === historicSeries);
  await schedule(alice, "replace_series", event("2099-03-01T12:00", { id: upcoming.id, recurrence: "daily" }));
  assert.equal((await window(alice, "2026-01-01", "2026-01-01", "Africa/Lagos")).occurrences[0].id, historic.id);
  assert.deepEqual((await query(bob, "select id from public.study_events")).rows, []);
  await assert.rejects(query(alice, "update public.study_occurrences set status='completed'"), { code: "42501" });
});

test("timer credits confirmed activity, pauses stale browsers, completes once and audits corrections", async (t) => {
  const { db, schedule, timer, window, query, course } = await fixture(t);
  const courseId = await course(alice);
  await schedule(alice, "new_event", event("2026-01-02T09:00", { course_id: courseId }));
  const occurrence = (await window(alice, "2026-01-02", "2026-01-02", "Africa/Lagos")).occurrences[0];
  const request = { occurrence_id: occurrence.id, request_id: randomUUID(), course_id: null };
  await assert.rejects(timer(bob, "start", request), { code: "42501" });
  const started = await timer(alice, "start", request);
  assert.equal(started.log.course_id, courseId);
  assert.equal((await timer(alice, "start", { ...request, request_id: randomUUID() })).log.id, started.log.id);
  await assert.rejects(schedule(alice, "cancel_occurrence", { id: occurrence.id }), { code: "22023" });
  await db.query("update public.study_logs set running_since=clock_timestamp()-interval '10 seconds', confirmed_through=clock_timestamp()-interval '1 second' where id=$1", [started.log.id]);
  const paused = await timer(alice, "pause", ref(started));
  assert.equal(paused.log.status, "paused");
  assert.ok(paused.log.elapsed_ms >= 10000 && paused.log.elapsed_ms < 12000);
  assert.equal((await timer(alice, "read")).log.elapsed_ms, paused.log.elapsed_ms);
  const resumed = await timer(alice, "resume", ref(paused));
  assert.equal(resumed.log.status, "running");
  assert.equal((await timer(alice, "pause", ref(started))).log.status, "running");
  await db.query("update public.study_logs set running_since=clock_timestamp()-interval '120 seconds', confirmed_through=clock_timestamp()-interval '110 seconds' where id=$1", [started.log.id]);
  const reconciled = await timer(alice, "read");
  assert.equal(reconciled.log.pause_reason, "inactive");
  assert.ok(reconciled.log.elapsed_ms >= paused.log.elapsed_ms + 9990 && reconciled.log.elapsed_ms < paused.log.elapsed_ms + 10050);
  const completed = await timer(alice, "finish", ref(reconciled));
  assert.equal(completed.log.status, "completed");
  assert.deepEqual((await timer(alice, "finish", ref(reconciled))).log, completed.log);
  assert.deepEqual((await timer(alice, "start", request)).log, completed.log);
  assert.equal((await timer(alice, "read")).log, null);
  assert.equal((await window(alice, "2026-01-02", "2026-01-02", "Africa/Lagos")).occurrences[0].status, "completed");
  await assert.rejects(timer(bob, "correct", { ...ref(completed), seconds: 123, reason: "Denied" }), { code: "42501" });
  const corrected = await timer(alice, "correct", { ...ref(completed), seconds: 120, reason: "Clock correction" });
  assert.equal(corrected.log.corrected_seconds, 120);
  await timer(alice, "correct", { ...ref(completed), seconds: 180, reason: "Stale edit" });
  assert.deepEqual((await query(alice, "select new_seconds, reason from public.study_log_corrections")).rows,
    [{ new_seconds: 120, reason: "Clock correction" }]);
  assert.deepEqual((await query(bob, "select id from public.study_logs")).rows, []);
  const unplanned = await timer(alice, "start", { request_id: randomUUID() });
  assert.equal((await timer(alice, "discard", ref(unplanned))).log.status, "discarded");
  assert.equal((await timer(alice, "read")).log, null);
});

test("analytics totals match completed local days, topic progress, deadline status, and eligible sessions", async (t) => {
  const { db, schedule, timer, window, report, course, query } = await fixture(t);
  const courseId = await course(alice);
  const title = (name) => ({ course_id: courseId, title: name });
  await schedule(alice, "new_event", event("2026-01-02T10:00", title("Completed")));
  await schedule(alice, "new_event", event("2026-01-02T11:00", title("Missed")));
  await schedule(alice, "new_event", event("2026-01-02T12:00", title("Cancelled")));
  await schedule(alice, "new_event", event("2099-01-02T10:00", title("Future")));
  const sessions = (await window(alice, "2026-01-02", "2026-01-02", "Africa/Lagos", courseId)).occurrences;
  await schedule(alice, "cancel_occurrence", { id: sessions[2].id });
  const active = await timer(alice, "start", { request_id: randomUUID(), occurrence_id: sessions[0].id });
  await db.query("update public.study_logs set elapsed_ms=120000 where id=$1", [active.log.id]);
  const finished = await timer(alice, "finish", ref(active));
  await timer(alice, "correct", { ...ref(finished), seconds: 120, reason: "Fixture duration" });
  // One local day starts while the previous UTC day is still open.
  await db.query("update public.study_logs set started_at='2026-01-01T22:55:00Z', finished_at='2026-01-01T23:01:00Z' where id=$1", [finished.log.id]);
  await query(alice, "insert into public.topics(course_id,title,completed_at) values ($1,'Done',now()),($1,'Open',null)", [courseId]);
  await schedule(alice, "save_deadline", { ...event("2026-01-02T08:00", title("Overdue assignment")), category: "assignment" });
  const exam = await schedule(alice, "save_deadline", { ...event("2099-01-02T08:00", title("Future exam")), category: "exam" });

  const stats = await report(alice, "2026-01-01", "2026-01-02", "Africa/Lagos", courseId);
  assert.equal(stats.seconds, 120);
  assert.equal(stats.days_with_study, 1);
  assert.deepEqual(stats.days, [{ date: "2026-01-01", seconds: 0 }, { date: "2026-01-02", seconds: 120 }]);
  assert.deepEqual(stats.adherence, { completed: 1, eligible: 2 });
  assert.deepEqual(stats.topics, { completed: 1, total: 2 });
  assert.equal(stats.overdue[0].title, "Overdue assignment");
  assert.equal(stats.upcoming[0].title, "Future exam");
  assert.equal((await report(alice, "2099-01-01", "2099-01-02", "Africa/Lagos", courseId)).adherence.eligible, 0);
  await schedule(alice, "deadline_status", { id: exam, status: "done" });
  assert.equal((await report(alice, "2026-01-01", "2026-01-02", "Africa/Lagos", courseId)).upcoming.length, 0);
  const foreign = await report(bob, "2026-01-01", "2026-01-02", "Africa/Lagos");
  assert.equal(foreign.seconds, 0);
  assert.deepEqual(foreign.overdue, []);
});
