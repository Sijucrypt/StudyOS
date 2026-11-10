// Loopback-only Supabase test double. Auth and HTTP are fixtures. Database reads and
// writes use PostgreSQL through the production migration and authenticated role.
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { alice, asUser, asWorker, bob, testDatabase } from "./database.mjs";
import { BUCKET } from "../../src/features/library/formats.mjs";

const db = await testDatabase();
const users = [alice, bob].map((id, index) => ({
  id,
  email: index === 0 ? "alice@studyos.test" : "bob@studyos.test",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
}));
const sessions = new Map();
const uploadTokens = new Map();
const readTokens = new Map();
const objects = new Map();
const workerKey = "studyos-loopback-worker";
const port = Number(process.env.STUDYOS_FIXTURE_PORT ?? 54329);
const telegramFixture = process.env.STUDYOS_TELEGRAM_FIXTURE === "1";
const telegramDeliveries = [];
const tables = {
  profiles: "id display_name timezone",
  academic_sessions: "id user_id label starts_on ends_on archived_at",
  semesters: "id user_id academic_session_id name starts_on ends_on archived_at harmattan_imported_at",
  courses: "id user_id semester_id code title units description archived_at",
  topics: "id user_id course_id parent_topic_id title sort_order completed_at archived_at",
  materials: "id user_id course_id name mime_type byte_size storage_key upload_state extraction_state page_count deleted_at",
  notes: "id user_id course_id title body revision created_at updated_at deleted_at",
  ai_results: "id user_id course_id kind question title output provider model revision created_at saved_at",
  ai_result_sources: "result_id user_id course_id citation_id material_id source_name mime_type chunk_index page_start page_end",
  ai_usage: "id user_id status error_code actual_tokens latency_ms",
  study_logs: "id user_id course_id occurrence_id started_at finished_at elapsed_ms corrected_seconds status revision",
};

const appCalls = {
  retrieve_ai_evidence: ["select * from public.retrieve_ai_evidence($1,$2,$3)",
    ["course_scope", "source_ids", "question"]],
  reserve_ai_usage: ["select public.reserve_ai_usage($1,$2,$3,$4,$5,$6,$7,$8) as result",
    ["provider_name", "model_name", "operation_name", "token_reservation", "cost_reservation", "daily_requests", "daily_tokens", "daily_cost"]],
  store_ai_result: ["select public.store_ai_result($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as result",
    ["course_scope", "output_kind", "user_question", "output_title", "output_body", "source_ids", "provider_name", "model_name", "prompt_id", "refs"]],
  study_schedule: ["select public.study_schedule($1,$2) as result", ["operation", "payload"]],
  study_timer: ["select public.study_timer($1,$2) as result", ["operation", "payload"]],
  study_window: ["select public.study_window($1,$2,$3,$4) as result", ["first_day", "last_day", "view_zone", "course_scope"]],
  study_metrics: ["select public.study_metrics($1,$2,$3,$4) as result", ["first_day", "last_day", "view_zone", "course_scope"]],
  telegram_state: ["select public.telegram_state() as result", []],
  telegram_settings_action: ["select public.telegram_settings_action($1,$2) as result", ["operation", "payload"]],
};

const telegramWorkerCalls = {
  telegram_handle_update: ["select public.telegram_handle_update($1,$2,$3,$4) as result", ["incoming_id", "command", "incoming_chat", "token_digest"]],
  refresh_telegram_outbox: ["select public.refresh_telegram_outbox() as result", []],
  claim_telegram_outbox: ["select public.claim_telegram_outbox() as result", []],
  prepare_telegram_send: ["select public.prepare_telegram_send($1,$2) as result", ["job_id", "lease_token"]],
  finish_telegram_send: ["select public.finish_telegram_send($1,$2,$3,$4) as result", ["job_id", "lease_token", "result", "retry_seconds"]],
};

function reply(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

async function payload(request) {
  let text = "";
  for await (const chunk of request) text += chunk;
  return text ? JSON.parse(text) : {};
}

async function rest(request, response, url, user) {
  const { pathname, searchParams } = url;
  const body = await payload(request);
  const rpcName = pathname.split("/").at(-1);
  if (pathname.startsWith("/rest/v1/rpc/") && Object.hasOwn(telegramWorkerCalls, rpcName)) {
    if (!telegramFixture || request.headers.apikey !== workerKey) return reply(response, 403, { message: "Worker access required." });
    const [query, names] = telegramWorkerCalls[rpcName];
    const { rows } = await asWorker(db, (tx) => tx.query(query, names.map((name) => body[name])));
    return reply(response, 200, rows[0].result);
  }
  if (pathname.startsWith("/rest/v1/rpc/") && Object.hasOwn(appCalls, rpcName)) {
    const [query, names] = appCalls[rpcName];
    const { rows } = await asUser(db, user?.id, (tx) => tx.query(query, names.map((name) =>
      ["refs", "output_body", "payload"].includes(name) ? JSON.stringify(body[name]) : body[name])));
    return reply(response, 200, rpcName === "retrieve_ai_evidence" ? rows : rows[0].result);
  }
  if (pathname === "/rest/v1/rpc/import_harmattan" && request.method === "POST") {
    const { rows } = await asUser(db, user?.id, (tx) =>
      tx.query("select public.import_harmattan($1) as count", [body.target_semester]));
    return reply(response, 200, rows[0].count);
  }
  if (pathname === "/rest/v1/rpc/search_materials") {
    const { rows } = await asUser(db, user?.id, (tx) => tx.query("select * from public.search_materials($1,$2,$3)",
      [body.course_scope, body.search_term, body.page_offset]));
    return reply(response, 200, rows);
  }
  if (pathname === "/rest/v1/rpc/change_material") {
    const { rows } = await asUser(db, user?.id, (tx) =>
      tx.query("select public.change_material($1,$2) as ok", [body.target_id, body.operation]));
    return reply(response, 200, rows[0].ok);
  }
  if (pathname === "/rest/v1/rpc/claim_material_job" && request.headers.apikey === workerKey) {
    const { rows } = await asWorker(db, (tx) => tx.query("select * from public.claim_material_job()"));
    return reply(response, 200, rows);
  }
  if (pathname === "/rest/v1/rpc/finish_material_job" && request.headers.apikey === workerKey) {
    const { rows } = await asWorker(db, (tx) => tx.query(
      "select public.finish_material_job($1,$2,$3,$4,$5,$6) as ok",
      [body.target_id, body.token, body.outcome, body.result_hash, body.result_pages, JSON.stringify(body.result_chunks)],
    ));
    return reply(response, 200, rows[0].ok);
  }

  const table = pathname.split("/").at(-1);
  if (!Object.hasOwn(tables, table)) return reply(response, 404, { message: "Unknown fixture route." });
  const allowed = tables[table].split(" ");
  const column = (name) => {
    if (!allowed.includes(name)) throw new Error("Unexpected fixture column: " + name);
    return '"' + name + '"';
  };
  const columns = Object.keys(body).map(column);
  const values = Object.values(body);
  const bind = (value) => {
    values.push(value);
    return "$" + values.length;
  };
  const filters = [];
  for (const [name, condition] of searchParams) {
    if (["select", "order", "offset", "limit", "on_conflict"].includes(name)) continue;
    if (condition === "is.null") filters.push(column(name) + " is null");
    else if (condition.startsWith("eq.")) filters.push(column(name) + " = " + bind(condition.slice(3)));
    else if (condition.startsWith("neq.")) filters.push(column(name) + " <> " + bind(condition.slice(4)));
    else if (condition.startsWith("in.(") && condition.endsWith(")")) {
      const entries = condition.slice(4, -1).split(",").map((value) => bind(value.replace(/^"|"$/g, "")));
      filters.push(column(name) + " in (" + entries.join(", ") + ")");
    }
    else throw new Error("Unexpected fixture filter");
  }
  const where = filters.length ? " where " + filters.join(" and ") : "";
  const selection = (searchParams.get("select") ?? "id").split(",").map(column).join(", ");
  const relation = "public." + table;
  let sql;
  switch (request.method) {
    case "GET": {
      const order = (searchParams.get("order") ?? "").split(",").filter(Boolean).map((entry) => {
        const [name, direction] = entry.split(".");
        return column(name) + (direction === "desc" ? " desc" : " asc");
      });
      const sort = order.length ? " order by " + order.join(", ") : "";
      sql = "select " + selection + " from " + relation + where + sort
        + " limit " + bind(Number(searchParams.get("limit") ?? 1000))
        + " offset " + bind(Number(searchParams.get("offset") ?? 0));
      break;
    }
    case "POST": {
      sql = "insert into " + relation + " (" + columns.join(", ") + ") values ("
        + columns.map((_, index) => "$" + (index + 1)).join(", ") + ")";
      if (table === "profiles" && request.headers.prefer?.includes("resolution=merge-duplicates")) {
        sql += " on conflict (id) do update set display_name = excluded.display_name, timezone = excluded.timezone";
      }
      break;
    }
    case "PATCH":
      sql = "update " + relation + " set "
        + columns.map((name, index) => name + " = $" + (index + 1)).join(", ") + where;
      break;
    default:
      return reply(response, 405, { message: "Unsupported fixture request method." });
  }
  const read = request.method === "GET";
  const returning = request.headers.prefer?.includes("return=representation");
  if (!read && returning) sql += " returning " + selection;

  const { rows } = await asUser(db, user?.id, (tx) => tx.query(sql, values));
  if (!read && !returning) return reply(response, 204);
  if (request.headers.accept?.includes("application/vnd.pgrst.object+json")) {
    if (rows.length !== 1) return reply(response, 406, { code: "PGRST116", message: "Expected one record." });
    return reply(response, 200, rows[0]);
  }
  return reply(response, 200, rows);
}

async function storage(request, response, url, user) {
  const prefix = "/storage/v1/object/";
  const route = url.pathname.slice(prefix.length);
  const upload = "upload/sign/" + BUCKET + "/";
  const sign = "sign/" + BUCKET + "/";
  const auth = "authenticated/" + BUCKET + "/";
  const token = url.searchParams.get("token");
  if (route.startsWith(upload)) {
    const key = route.slice(upload.length);
    if (request.method === "POST") {
      const { rows } = await asUser(db, user?.id, (tx) => tx.query(
        "select id from public.materials where storage_key=$1 and upload_state='pending'", [key],
      ));
      if (!rows.length) return reply(response, 403, { message: "Invalid reservation." });
      const id = randomUUID();
      uploadTokens.set(id, { user, key });
      return reply(response, 200, { url: "/object/" + upload + key + "?token=" + id });
    }
    const ticket = uploadTokens.get(token);
    if (request.method === "PUT" && ticket?.key === key && !objects.has(key)) {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const form = await new Response(Buffer.concat(chunks), {
        headers: { "Content-Type": request.headers["content-type"] },
      }).formData();
      const file = form.get("");
      await asUser(db, ticket.user.id, (tx) => tx.query(
        "insert into storage.objects(bucket_id,name) values ($1,$2)", [BUCKET, key],
      ));
      objects.set(key, { type: file.type, bytes: Buffer.from(await file.arrayBuffer()) });
      return reply(response, 200, { Key: BUCKET + "/" + key });
    }
  }
  if (route.startsWith(sign)) {
    const key = route.slice(sign.length);
    if (request.method === "POST") {
      const { rows } = await asUser(db, user?.id, (tx) => tx.query(
        "select name from storage.objects where bucket_id=$1 and name=$2", [BUCKET, key],
      ));
      if (!rows.length) return reply(response, 404, { message: "Not available." });
      const id = randomUUID();
      readTokens.set(id, key);
      return reply(response, 200, { signedURL: "/object/" + sign + key + "?token=" + id });
    }
    if (request.method === "GET" && readTokens.get(token) === key) return serve(response, key, url.searchParams.get("download"));
  }
  if (request.headers.apikey === workerKey && request.method === "GET") {
    if (route.startsWith(auth)) return serve(response, route.slice(auth.length));
    if (route.startsWith(BUCKET + "/")) return serve(response, route.slice(BUCKET.length + 1));
  }
  return reply(response, 404, { message: "Storage object not available." });
}

function serve(response, key, download) {
  const object = objects.get(key);
  if (!object) return reply(response, 404, { message: "File unavailable." });
  const headers = { "Content-Type": object.type, "Content-Length": object.bytes.length };
  if (download) headers["Content-Disposition"] = 'attachment; filename="' + download + '"';
  response.writeHead(200, headers);
  response.end(object.bytes);
}

createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const token = request.headers.authorization?.slice(7);
  const user = sessions.get(token);
  try {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,OPTIONS");
    if (request.method === "OPTIONS") return reply(response, 204);
    if (url.pathname === "/health") return reply(response, 200, { ready: true });
    if (url.pathname.startsWith("/fixture-telegram/") && telegramFixture) {
      if (request.headers["x-studyos-fixture-key"] !== workerKey) return reply(response, 403, { ok: false });
      if (url.pathname === "/fixture-telegram/sendMessage" && request.method === "POST") {
        const { chat_id, text } = await payload(request);
        if (typeof chat_id !== "string" || typeof text !== "string") return reply(response, 400, { ok: false, error_code: 400 });
        telegramDeliveries.push({ chat_id, text });
        return reply(response, 200, { ok: true, result: { message_id: telegramDeliveries.length } });
      }
      if (url.pathname === "/fixture-telegram/deliveries" && request.method === "GET") {
        return reply(response, 200, telegramDeliveries);
      }
    }
    if (url.pathname === "/auth/v1/token") {
      const { email, password } = await payload(request);
      const account = users.find((item) => item.email === email);
      if (!account || password !== "local-fixture-password") {
        return reply(response, 400, { code: "invalid_credentials", message: "Invalid credentials" });
      }
      const iat = Math.floor(Date.now() / 1000);
      const exp = iat + 3600;
      const encode = (object) => Buffer.from(JSON.stringify(object)).toString("base64url");
      const jwt = encode({ alg: "HS256", typ: "JWT" }) + "." + encode({
        iat, exp, sub: account.id, aud: "authenticated", role: "authenticated", jti: randomUUID(),
      }) + ".Zml4dHVyZQ";
      sessions.set(jwt, account);
      return reply(response, 200, {
        access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp,
        refresh_token: randomUUID(), user: account,
      });
    }
    if (url.pathname === "/auth/v1/user") {
      return user ? reply(response, 200, user)
        : reply(response, 401, { code: "session_not_found", message: "Fixture session not found." });
    }
    if (url.pathname === "/auth/v1/logout") {
      sessions.delete(token);
      return reply(response, 204);
    }
    if (url.pathname.startsWith("/rest/v1/")) return await rest(request, response, url, user);
    if (url.pathname.startsWith("/storage/v1/object/")) return await storage(request, response, url, user);
    return reply(response, 404, { message: "Unknown fixture route." });
  } catch (error) {
    if (!error.code) console.error(error);
    return reply(response, error.code === "42501" ? 403 : 400, {
      code: error.code ?? "fixture_error", message: error.message,
    });
  }
}).listen(port, "127.0.0.1", () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:" + port;
  process.env.SUPABASE_WORKER_KEY = workerKey;
  if (process.env.STUDYOS_FIXTURE_MANUAL_LIBRARY !== "1") {
    void import("../../scripts/library-worker.mjs");
  }
});
