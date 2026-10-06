// Minimal PostgREST look-alike on http://localhost:54321 for local development.
import http from "node:http";
import { callRpc, openDatabase } from "./local-db.mjs";

const PORT = Number(process.env.API_PORT ?? 54321);
const db = await openDatabase("./.data/pglite-local");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

http
  .createServer(async (req, res) => {
    if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
    const match = req.url?.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (req.method !== "POST" || !match) return res.writeHead(404, cors).end();
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const result = await callRpc(db, match[1], body ? JSON.parse(body) : {});
      res.writeHead(200, { ...cors, "Content-Type": "application/json" }).end(JSON.stringify(result));
    } catch (err) {
      res
        .writeHead(400, { ...cors, "Content-Type": "application/json" })
        .end(JSON.stringify({ message: err.message, hint: err.hint ?? null, code: err.code ?? null }));
    }
  })
  .listen(PORT, () => console.log(`Local Supabase stand-in on http://localhost:${PORT} (instructor password: admin)`));
