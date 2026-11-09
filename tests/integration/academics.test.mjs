import assert from "node:assert/strict";
import { test } from "node:test";
import { alice, asUser, bob, testDatabase } from "../support/database.mjs";

async function fixtures(t) {
  const db = await testDatabase();
  t.after(() => db.close());
  const query = (user, statement, params) => asUser(db, user, (tx) => tx.query(statement, params));
  const insert = async (user, statement, params) => (await query(user, statement + " returning id", params)).rows[0].id;
  const session = (user, label) => insert(user, "insert into public.academic_sessions (label) values ($1)", [label]);
  const semester = (user, ownerSession, name) => insert(user,
    "insert into public.semesters (academic_session_id, name) values ($1, $2)", [ownerSession, name]);
  const course = (user, code, semesterId = null) => insert(user,
    "insert into public.courses (code, title, semester_id) values ($1, 'Course', $2)", [code, semesterId]);
  const topic = (user, courseId, parent = null) => insert(user,
    "insert into public.topics (course_id, parent_topic_id, title) values ($1, $2, 'Topic')", [courseId, parent]);
  return { query, session, semester, course, topic };
}

test("RLS isolates both users and blocks anonymous access and cross-owner links", async (t) => {
  const { query, session, semester, course, topic } = await fixtures(t);
  const aliceSession = await session(alice, "Personal");
  const aliceSemester = await semester(alice, aliceSession, "Winter");
  const aliceCourse = await course(alice, "MATH1", aliceSemester);
  const aliceTopic = await topic(alice, aliceCourse);
  const bobSession = await session(bob, "Personal");
  const bobCourse = await course(bob, "OTHER");
  await query(alice, "insert into public.profiles (display_name) values ('Alice')");
  assert.deepEqual((await query(bob, "select * from public.profiles")).rows, []);
  for (const table of ["academic_sessions", "semesters", "courses", "topics"]) {
    const { rows } = await query(bob, "select user_id from public." + table);
    assert.ok(rows.every((row) => row.user_id === bob));
    await assert.rejects(query(null, "select * from public." + table), { code: "42501" });
  }
  assert.equal((await query(bob, "update public.courses set title = 'Changed' where id = $1", [aliceCourse])).affectedRows, 0);
  await assert.rejects(query(bob, "insert into public.academic_sessions (label, user_id) values ('Forged', $1)", [alice]), { code: "42501" });
  await assert.rejects(semester(bob, aliceSession, "Forged"), { code: "23503" });
  await assert.rejects(course(bob, "FORGED", aliceSemester), { code: "23503" });
  await assert.rejects(topic(bob, bobCourse, aliceTopic), { code: "23503" });
  await assert.rejects(topic(alice, await course(alice, "SECOND"), aliceTopic), { code: "23503" });
  await assert.rejects(query(bob, "select public.import_harmattan($1)", [aliceSemester]), { code: "42501" });
  await assert.rejects(query(null, "select public.import_harmattan($1)", [aliceSemester]), { code: "42501" });
  assert.ok(bobSession);
});

test("optional seed imports the exact catalog once and keeps pre-existing edits", async (t) => {
  const { query, session, semester, course } = await fixtures(t);
  const parent = await session(alice, "Owner label");
  const seedSemester = await semester(alice, parent, "Any name");
  const importSql = "select public.import_harmattan($1) as count";
  assert.deepEqual((await query(alice, importSql, [seedSemester])).rows, [{ count: 10 }]);
  const seeded = (await query(alice, "select code, title, units from public.courses order by code")).rows;
  assert.deepEqual(seeded.map(({ code }) => code), [
    "CSC401", "CSC403", "CYB401", "CYB403", "CYB405", "CYB407", "CYB409", "CYB411", "CYB415", "CYB497",
  ]);
  assert.equal(seeded.reduce((sum, row) => sum + row.units, 0), 22);
  await query(alice, "update public.courses set code = 'RENAMED', semester_id = null where code = 'CSC401'");
  assert.deepEqual((await query(alice, importSql, [seedSemester])).rows, [{ count: 0 }]);

  const existingSemester = await semester(alice, parent, "Second");
  const existing = await course(alice, " csc401 ", existingSemester);
  assert.deepEqual((await query(alice, importSql, [existingSemester])).rows, [{ count: 9 }]);
  assert.equal((await query(alice, "select title from public.courses where id = $1", [existing])).rows[0].title, "Course");
  await assert.rejects(query(alice, "update public.semesters set harmattan_imported_at = null"), { code: "42501" });
  await query(alice, "update public.academic_sessions set archived_at = now() where id = $1", [parent]);
  await assert.rejects(query(alice, importSql, [existingSemester]), { code: "42501" });
});

test("course moves keep topic progress, duplicates collide, and topic cycles are rejected", async (t) => {
  const { query, session, semester, course, topic } = await fixtures(t);
  const parent = await session(alice, "Flexible session");
  const autumn = await semester(alice, parent, "Autumn");
  const spring = await semester(alice, parent, "Spring");
  const original = await course(alice, "BIO1", autumn);
  const first = await topic(alice, original);
  const second = await topic(alice, original, first);
  await query(alice, "update public.topics set completed_at = now() where id = $1", [second]);
  await assert.rejects(query(alice, "update public.topics set parent_topic_id = $2 where id = $1", [first, second]), { code: "23514" });
  await query(alice, "update public.courses set semester_id = $2 where id = $1", [original, spring]);
  const { rows } = await query(alice, "select course_id, completed_at from public.topics where id = $1", [second]);
  assert.equal(rows[0].course_id, original);
  assert.ok(rows[0].completed_at);
  await assert.rejects(course(alice, " bio1 ", spring), { code: "23505" });
  assert.notEqual(await course(alice, "BIO1"), original);
  await assert.rejects(query(alice, "delete from public.academic_sessions"), { code: "42501" });
});
