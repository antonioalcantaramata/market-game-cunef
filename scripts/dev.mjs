// `npm run dev`: local database API + Next.js dev server.
import { spawn } from "node:child_process";

const procs = [
  spawn("node", ["scripts/dev-api.mjs"], { stdio: "inherit" }),
  spawn("npx", ["next", "dev", ...process.argv.slice(2)], { stdio: "inherit" }),
];
const stop = () => procs.forEach((p) => p.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
procs.forEach((p) => p.on("exit", stop));
