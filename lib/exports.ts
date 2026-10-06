import { api } from "./api";
import { EXPORTS } from "./export-columns";

export { EXPORTS };

function toCsv(rows: Record<string, unknown>[], columns: string[]) {
  const cell = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\n");
}

/** Builds the CSV in the browser and saves it. */
export async function downloadCsv(sessionId: string, file: string) {
  const rows = await api.exportRows(sessionId, file);
  const blob = new Blob(["﻿" + toCsv(rows, EXPORTS[file].columns)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `market-${sessionId}-${file}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
