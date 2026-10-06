// Local stand-in for Supabase, used by `npm run dev` and the tests.
// PGlite is a real Postgres compiled to WebAssembly, so supabase/schema.sql
// runs unchanged. Calls are executed as the `anon` role, like on Supabase.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";

const SCHEMA = path.join(import.meta.dirname, "..", "supabase", "schema.sql");

export async function openDatabase(dataDir, adminPassword = "admin") {
  if (dataDir) fs.mkdirSync(path.dirname(dataDir), { recursive: true });
  const db = new PGlite(dataDir);
  // Roles that Supabase provides out of the box.
  await db.exec(`
    do $$ begin
      if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    end $$;
    grant usage on schema public to anon, authenticated;`);
  await db.exec(fs.readFileSync(SCHEMA, "utf8"));
  const { rows } = await db.query("select 1 from app_config");
  if (rows.length === 0) await db.query("select set_admin_password($1)", [adminPassword]);
  return db;
}

const NAME = /^[a-z_]+$/;

/** Calls a function the way PostgREST does (POST /rest/v1/rpc/:fn), as the anon role. */
export async function callRpc(db, fn, args = {}) {
  if (!NAME.test(fn) || !Object.keys(args).every((k) => NAME.test(k))) throw new Error("Bad RPC name");
  const keys = Object.keys(args);
  const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`;
  const params = keys.map((k) => {
    const v = args[k];
    return v == null ? null : typeof v === "object" ? JSON.stringify(v) : String(v);
  });
  return db.transaction(async (tx) => {
    await tx.exec("set local role anon");
    const { rows } = await tx.query(sql, params);
    return rows[0].r;
  });
}
