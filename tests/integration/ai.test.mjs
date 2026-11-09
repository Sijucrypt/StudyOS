import assert from "node:assert/strict";
import { test } from "node:test";
import { alice, asUser, asWorker, bob, testDatabase } from "../support/database.mjs";
import { validateOutput } from "../../src/features/ai/contracts.ts";
import { generateWithGemini, MAX_INPUT_TOKENS } from "../../src/features/ai/gemini.mjs";

async function fixtures(t) {
  const db = await testDatabase();
  t.after(() => db.close());
  const query = (user, sql, args) => asUser(db, user, (tx) => tx.query(sql, args));
  const course = async (user) => (await query(user, "insert into public.courses(code,title) values ('AI','Sources') returning id")).rows[0].id;
  const source = async (user, courseId, text) => {
    const id = (await query(user,
      "insert into public.materials(course_id,name,mime_type,byte_size) values ($1,'source.pdf','application/pdf',100) returning id", [courseId],
    )).rows[0].id;
    await asWorker(db, async (tx) => {
      await tx.query("update public.materials set upload_state='verified', extraction_state='ready' where id=$1", [id]);
      await tx.query("insert into public.document_chunks(user_id,material_id,chunk_index,text,page_start,page_end) values ($1,$2,0,$3,2,2)", [user, id, text]);
    });
    return id;
  };
  return { query, course, source };
}

test("retrieval scopes excerpts to the exact selected, ready and owned course materials", async (t) => {
  const { query, course, source } = await fixtures(t);
  const current = await course(alice);
  const otherCourse = await course(alice);
  const bobsCourse = await course(bob);
  const selected = await source(alice, current, "Photosynthesis turns light into chemical energy.");
  const unselected = await source(alice, current, "Unselected photosynthesis solution.");
  const outside = await source(alice, otherCourse, "Other course photosynthesis.");
  const foreign = await source(bob, bobsCourse, "Private photosynthesis data.");
  const fetch = (user, scope, ids, question) => query(user,
    "select material_id, excerpt, page_start from public.retrieve_ai_evidence($1,$2,$3)", [scope, ids, question]);
  assert.deepEqual((await fetch(alice, current, [selected], "What is photosynthesis?")).rows, [
    { material_id: selected, excerpt: "Photosynthesis turns light into chemical energy.", page_start: 2 },
  ]);
  assert.deepEqual((await fetch(alice, current, [selected], "What is quantum tunneling?")).rows, []);
  assert.deepEqual((await fetch(alice, current, [selected, unselected], null)).rows.map((r) => r.material_id).sort(), [selected, unselected].sort());
  await assert.rejects(fetch(alice, current, [selected, outside], null), { code: "42501" });
  await assert.rejects(fetch(alice, current, [selected, foreign], null), { code: "42501" });
  await assert.rejects(fetch(alice, current, [selected, selected], null), { code: "42501" });
  await assert.rejects(fetch(bob, current, [selected], null), { code: "42501" });
  await assert.rejects(fetch(null, current, [selected], null), { code: "42501" });
  await query(alice, "select public.change_material($1,'remove')", [selected]);
  await assert.rejects(fetch(alice, current, [selected], null), { code: "42501" });
});

test("result references, revisions and usage reservations enforce ownership and daily caps", async (t) => {
  const { query, course, source } = await fixtures(t);
  const current = await course(alice);
  const bobsCourse = await course(bob);
  const selected = await source(alice, current, "The source.");
  const foreign = await source(bob, bobsCourse, "Foreign source.");
  const output = { outcome: "grounded", title: "Draft", items: [{ heading: "Topic", body: "The source.", citations: ["S1"], options: [], correctOption: -1 }] };
  const store = (user, material, page = 2) => query(user,
    "select public.store_ai_result($1,'summary',null,'Draft',$2,$3,'fixture','test','v1',$4) as id",
    [current, JSON.stringify(output), [selected], JSON.stringify([{ citation_id: "S1", material_id: material, chunk_index: 0, page_start: page, page_end: page }])],
  );
  await assert.rejects(store(alice, foreign), { code: "42501" });
  await assert.rejects(store(alice, selected, 999), { code: "42501" });
  await assert.rejects(store(bob, selected), { code: "42501" });
  assert.deepEqual((await query(alice, "select * from public.ai_results")).rows, []);
  const result = (await store(alice, selected)).rows[0].id;
  assert.deepEqual((await query(bob, "select id from public.ai_results")).rows, []);
  assert.deepEqual((await query(bob, "select citation_id from public.ai_result_sources")).rows, []);
  assert.deepEqual((await query(alice, "select citation_id,page_start from public.ai_result_sources where result_id=$1", [result])).rows,
    [{ citation_id: "S1", page_start: 2 }]);
  assert.deepEqual((await query(alice, "update public.ai_results set title='Edited' where id=$1 and revision=1 returning revision", [result])).rows,
    [{ revision: 2 }]);
  assert.deepEqual((await query(alice, "update public.ai_results set title='Stale' where id=$1 and revision=1 returning revision", [result])).rows, []);

  const reserve = async (user, requests, tokens, cost) => (await query(user,
    "select public.reserve_ai_usage('gemini','test','summary',100,30,$1,$2,$3) as id", [requests, tokens, cost],
  )).rows[0].id;
  assert.ok(await reserve(alice, 2, 200, 60));
  assert.equal(await reserve(alice, 1, 200, 60), null);
  assert.equal(await reserve(alice, 2, 199, 60), null);
  assert.equal(await reserve(alice, 2, 200, 59), null);
  assert.ok(await reserve(alice, 2, 200, 60));
  assert.equal(await reserve(alice, 2, 200, 60), null);
  assert.ok(await reserve(bob, 1, 100, 30));
  await assert.rejects(query(alice, "update public.ai_usage set reserved_tokens=1"), { code: "42501" });
});

test("output validation rejects fabricated citations and malformed quiz structures", () => {
  const item = { heading: "Question", body: "Evidence", citations: ["S1"], options: [], correctOption: -1 };
  const output = { outcome: "grounded", title: "Resource", items: [item] };
  const ids = new Set(["S1"]);
  assert.ok(validateOutput(output, "summary", ids));
  assert.equal(validateOutput({ ...output, items: [{ ...item, citations: ["S2"] }] }, "summary", ids), null);
  assert.equal(validateOutput({ ...output, items: [{ ...item, citations: [] }] }, "chat", ids), null);
  assert.equal(validateOutput({ ...output, outcome: "insufficient" }, "chat", ids), null);
  assert.equal(validateOutput({ ...output, items: [{ ...item, options: ["A", "A", "C", "D"], correctOption: 1 }] }, "mcq", ids), null);
  assert.ok(validateOutput({ ...output, items: [{ ...item, options: ["A", "B", "C", "D"], correctOption: 1 }] }, "mcq", ids));
});

test("Gemini adapter preflights token budget, uses structured output and fails closed", async () => {
  const provider = { model: "gemini-test", apiKey: "fixture-key" };
  const input = { instructions: "Grounding rules", prompt: "Question", evidence: [{ id: "S1", text: "Excerpt" }] };
  const calls = [];
  const result = await generateWithGemini(provider, input, async (url, request) => {
    calls.push({ url, request });
    return Response.json(calls.length === 1 ? { totalTokens: 80 } : {
      candidates: [{ finishReason: "STOP", content: { parts: [{ thought: true, text: "discard" }, { text: '{"title":"Test"}' }] } }],
      usageMetadata: { totalTokenCount: 100 },
    });
  });
  assert.deepEqual(result, { output: { title: "Test" }, tokens: 100 });
  assert.match(calls[0].url, /:countTokens$/);
  assert.match(calls[1].url, /:generateContent$/);
  assert.equal(calls[1].request.headers["x-goog-api-key"], "fixture-key");
  assert.ok(!calls[1].url.includes("fixture-key"));
  assert.equal(JSON.parse(calls[1].request.body).generationConfig.responseMimeType, "application/json");
  let count = 0;
  await assert.rejects(generateWithGemini(provider, input, async () => {
    count += 1;
    return Response.json({ totalTokens: MAX_INPUT_TOKENS + 1 });
  }));
  assert.equal(count, 1);
  await assert.rejects(generateWithGemini(provider, input, async () => new Response(null, { status: 503 })));
});
