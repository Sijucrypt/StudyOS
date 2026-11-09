import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

export const alice = "481e633e-103d-4f32-9517-46145a2dce29";
export const bob = "61e2a3b7-cb44-42b9-b9eb-bf4f231c6a47";

export async function testDatabase() {
  const db = new PGlite();
  try {
    // Minimal Supabase role and auth.uid() contract for running the real migration.
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable
        as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      grant usage on schema auth to anon, authenticated;
      create schema storage;
      create table storage.buckets (
        id text primary key, name text not null, public boolean, file_size_limit integer, allowed_mime_types text[]
      );
      create table storage.objects (bucket_id text, name text, primary key (bucket_id, name));
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated;
      grant select, insert on storage.objects to authenticated;
    `);
    await db.query("insert into auth.users values ($1), ($2)", [alice, bob]);
    const migrations = new URL("../../supabase/migrations/", import.meta.url);
    for (const migration of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(migration, migrations), "utf8"));
    }
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

export async function asWorker(db, run) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role service_role");
    return run(tx);
  });
}

export async function asUser(db, user, run) {
  return db.transaction(async (tx) => {
    await tx.exec(user ? "set local role authenticated" : "set local role anon");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [user ?? ""]);
    return run(tx);
  });
}
