// Saves every CSV of a session into a folder (the same files as "Download data"
// in the instructor panel, all at once).
//
//   node scripts/export-session.mjs <session-id> [folder]                 # local
//   SUPABASE_URL=… SUPABASE_ANON_KEY=… ADMIN_PASSWORD=… node scripts/export-session.mjs <id> [folder]

import fs from "node:fs";
import path from "node:path";
import { EXPORTS } from "../lib/export-columns.ts";

const URL = process.env.SUPABASE_URL || "http://localhost:54321";
const KEY = process.env.SUPABASE_ANON_KEY || "local-dev";
const PASSWORD = process.env.ADMIN_PASSWORD || "admin";

const [sessionId, folder = `export-${process.argv[2]}`] = process.argv.slice(2);
if (!sessionId) {
  console.error("Usage: node scripts/export-session.mjs <session-id> [folder]");
  process.exit(1);
}

async function rpc(fn, args) {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: KEY,
      ...(KEY.startsWith("eyJ") ? { Authorization: `Bearer ${KEY}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${fn}: ${data?.message ?? res.status}`);
  return data;
}

const cell = (v) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const { token } = await rpc("admin_login", { p_password: PASSWORD });
const { session } = await rpc("admin_session", { p_token: token, p_session: sessionId }); // fails if the id is wrong
console.log(`Session "${session.name}" (${sessionId})`);
fs.mkdirSync(folder, { recursive: true });
for (const [file, { columns }] of Object.entries(EXPORTS)) {
  const rows = await rpc("admin_export", { p_token: token, p_session: sessionId, p_file: file });
  const csv = [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\n");
  fs.writeFileSync(path.join(folder, `${file}.csv`), csv + "\n");
  console.log(`${path.join(folder, `${file}.csv`)}  (${rows.length} rows)`);
}
