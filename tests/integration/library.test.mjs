import assert from "node:assert/strict";
import { test } from "node:test";
import { alice, asUser, asWorker, bob, testDatabase } from "../support/database.mjs";
import { pdfFixture, zipFixture } from "../support/documents.mjs";
import { materialType } from "../../src/features/library/formats.mjs";
import { extractBytes, verifyBytes } from "../../src/features/library/parse.mjs";

test("reservations, storage RLS, leases, retries, and failed extraction preserve originals", async (t) => {
  const db = await testDatabase();
  t.after(() => db.close());
  const owner = (user, sql, params) => asUser(db, user, (tx) => tx.query(sql, params));
  const worker = (sql, params) => asWorker(db, (tx) => tx.query(sql, params));
  const course = (await owner(alice, "insert into public.courses(code,title) values ('ONE','Study') returning id")).rows[0].id;
  const reserve = "insert into public.materials(course_id,name,mime_type,byte_size) values ($1,'reading.pdf','application/pdf',750) returning id,storage_key";
  await assert.rejects(owner(bob, reserve, [course]), { code: "23503" });
  const { id, storage_key: key } = (await owner(alice, reserve, [course])).rows[0];
  assert.deepEqual((await owner(bob, "select * from public.materials")).rows, []);
  assert.deepEqual((await owner(alice, "select id from public.search_materials($1,'READ',0)", [course])).rows, [{ id }]);
  assert.deepEqual((await owner(bob, "select id from public.search_materials()")).rows, []);
  assert.deepEqual((await owner(alice, "select id from public.search_materials()")).rows, [{ id }]);

  const object = "insert into storage.objects (bucket_id,name) values ('studyos-materials',$1)";
  await assert.rejects(owner(bob, object, [key]), { code: "42501" });
  await assert.rejects(owner(alice, object, ["unreserved"]), { code: "42501" });
  await owner(alice, object, [key]);
  assert.deepEqual((await owner(alice, "select * from storage.objects")).rows, []);
  await assert.rejects(owner(alice, "update public.materials set upload_state='verified'"), { code: "42501" });
  await assert.rejects(owner(alice, "select * from public.claim_material_job()"), { code: "42501" });

  const change = "select public.change_material($1,$2) as ok";
  assert.deepEqual((await owner(bob, change, [id, "submit"])).rows, [{ ok: false }]);
  assert.deepEqual((await owner(alice, change, [id, "submit"])).rows, [{ ok: true }]);
  assert.deepEqual((await owner(alice, change, [id, "submit"])).rows, [{ ok: true }]);
  const claim = "select * from public.claim_material_job()";
  const finish = "select public.finish_material_job($1,$2,$3,$4) as ok";
  const verify = (await worker(claim)).rows[0];
  assert.equal(verify.stage, "verify");
  assert.deepEqual((await worker(claim)).rows, []);
  assert.deepEqual((await worker(finish, [id, id, "verified", "a".repeat(64)])).rows, [{ ok: false }]);
  assert.deepEqual((await worker(finish, [id, verify.lease_token, "verified", "a".repeat(64)])).rows, [{ ok: true }]);
  const extraction = (await worker(claim)).rows[0];
  assert.equal(extraction.stage, "extract");
  await worker(finish, [id, extraction.lease_token, "failed", null]);
  assert.deepEqual((await owner(alice, "select name from storage.objects")).rows, [{ name: key }]);
  assert.deepEqual((await owner(bob, "select * from storage.objects")).rows, []);
  assert.deepEqual((await owner(alice, change, [id, "retry"])).rows, [{ ok: true }]);
  const retry = (await worker(claim)).rows[0];
  await worker("select public.finish_material_job($1,$2,'ready',null,2,$3)", [
    id, retry.lease_token, JSON.stringify([{ text: "Grounded text", page_start: 2, page_end: 2 }]),
  ]);
  assert.deepEqual((await worker("select text,page_start from public.document_chunks")).rows, [{ text: "Grounded text", page_start: 2 }]);
  await assert.rejects(owner(alice, "select * from public.document_chunks"), { code: "42501" });
  await owner(alice, change, [id, "remove"]);
  assert.deepEqual((await owner(alice, "select * from storage.objects")).rows, []);
  assert.deepEqual((await worker("select text from public.document_chunks")).rows, []);

  // A forged low byte size cannot grant an unlimited number of maximum-size pending uploads.
  for (let i = 0; i < 9; i++) await owner(alice, reserve, [course]);
  await assert.rejects(owner(alice, reserve, [course]), { code: "P0001" });
  await worker("update public.materials set created_at = now() - interval '28 hours' where id = $1", [id]);
  const cleanup = (await worker(claim)).rows[0];
  assert.equal(cleanup.stage, "cleanup");
  await worker(finish, [id, cleanup.lease_token, "purged", null]);
  await owner(alice, reserve, [course]);
});

test("notes are course-scoped and a stale revision cannot overwrite a newer edit", async (t) => {
  const db = await testDatabase();
  t.after(() => db.close());
  const query = (user, sql, values) => asUser(db, user, (tx) => tx.query(sql, values));
  const { id: courseId } = (await query(alice, "insert into public.courses(code,title) values ('NOTES','Notes') returning id")).rows[0];
  const create = "insert into public.notes(course_id) values ($1) returning id,revision";
  const { id, revision } = (await query(alice, create, [courseId])).rows[0];
  await assert.rejects(query(bob, create, [courseId]), { code: "23503" });
  await assert.rejects(query(null, "select * from public.notes"), { code: "42501" });
  assert.deepEqual((await query(bob, "select * from public.notes")).rows, []);
  const edit = "update public.notes set title=$1 where id=$2 and course_id=$3 and revision=$4 returning revision";
  assert.deepEqual((await query(bob, edit, ["Other", id, courseId, revision])).rows, []);
  assert.deepEqual((await query(alice, edit, ["Winner", id, courseId, revision])).rows, [{ revision: revision + 1 }]);
  assert.deepEqual((await query(alice, edit, ["Stale", id, courseId, revision])).rows, []);
  await assert.rejects(query(alice, "update public.notes set revision=1"), { code: "42501" });
  await query(alice, "update public.notes set deleted_at=now() where id=$1", [id]);
  assert.deepEqual((await query(alice, edit, ["Deleted", id, courseId, revision + 2])).rows, []);
});

test("extracts text and page locations from supported documents and rejects mismatches", async () => {
  const pdf = pdfFixture();
  await verifyBytes(pdf, materialType("lecture.pdf"));
  const parsed = await extractBytes(pdf, materialType("lecture.pdf"));
  assert.equal(parsed.status, "ready");
  assert.equal(parsed.page_count, 1);
  assert.deepEqual(parsed.chunks, [{ text: "StudyOS test page", page_start: 1, page_end: 1 }]);
  assert.equal((await extractBytes(pdfFixture(""), materialType("blank.pdf"))).status, "needs_ocr");
  await assert.rejects(verifyBytes(Buffer.from("not a PDF"), materialType("bad.pdf")));
  const docx = zipFixture({
    "[Content_Types].xml": "<Types/>",
    "word/document.xml": '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Cell notes</w:t></w:r></w:p></w:document>',
  });
  await verifyBytes(docx, materialType("lecture.docx"));
  await assert.rejects(verifyBytes(docx, materialType("lecture.pptx")));
  assert.deepEqual((await extractBytes(docx, materialType("lecture.docx"))).chunks,
    [{ text: "Cell notes", page_start: null, page_end: null }]);
  const slideType = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
  const slideXml = (text) => '<a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>' + text + "</a:t></a:p>";
  const pptx = zipFixture({
    "[Content_Types].xml": "<Types/>",
    "ppt/presentation.xml": '<p:sldIdLst xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldId r:id="r2"/><p:sldId r:id="r1"/></p:sldIdLst>',
    "ppt/_rels/presentation.xml.rels": '<Relationships><Relationship Id="r1" Type="' + slideType + '" Target="slides/slide1.xml"/><Relationship Id="r2" Type="' + slideType + '" Target="slides/slide2.xml"/></Relationships>',
    "ppt/slides/slide1.xml": slideXml("Second in the deck"),
    "ppt/slides/slide2.xml": slideXml("First in the deck"),
  });
  await verifyBytes(pptx, materialType("lecture.pptx"));
  assert.deepEqual((await extractBytes(pptx, materialType("lecture.pptx"))).chunks, [
    { text: "First in the deck", page_start: 1, page_end: 1 },
    { text: "Second in the deck", page_start: 2, page_end: 2 },
  ]);
  const macro = zipFixture({ "[Content_Types].xml": "<Types/>", "word/document.xml": "<doc/>", "word/vbaProject.bin": "macro" });
  await assert.rejects(verifyBytes(macro, materialType("lecture.docx")));
  const md = Buffer.from("# Markdown notes");
  await verifyBytes(md, materialType("lecture.md"));
  assert.equal((await extractBytes(md, materialType("lecture.md"))).chunks[0].text, "# Markdown notes");
  await assert.rejects(verifyBytes(Buffer.from([255, 0]), materialType("binary.txt")));
});
