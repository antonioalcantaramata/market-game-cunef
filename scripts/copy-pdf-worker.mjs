// pdf.js renders slides in a Web Worker. The worker file is copied from
// node_modules into public/ so the static site can serve it (also on GitHub Pages).
import fs from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
fs.copyFileSync(
  path.join(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
  path.join(root, "public/pdf.worker.min.mjs"),
);
