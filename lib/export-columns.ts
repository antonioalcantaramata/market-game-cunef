// Column order of each CSV download. No imports, so the browser (lib/exports.ts)
// and the command-line export (scripts/export-session.mjs) share it.
export const EXPORTS: Record<string, { label: string; columns: string[] }> = {
  results: {
    label: "Results (round × team)",
    columns: [
      "session_id", "session_name", "round", "label", "phase", "demand_mw", "demand_low", "demand_high",
      "market_price", "marginal_price", "served_mw", "opened_at", "closed_at", "group_slot", "group_name",
      "group_code", "technology", "submitted", "bid_price", "revisions", "submitted_at", "dispatched", "paid_price",
      "profit",
    ],
  },
  bid_log: {
    label: "Every submission",
    columns: ["id", "round", "phase", "group_slot", "group_name", "technology", "price", "submitted_at", "seconds_after_open"],
  },
  rounds: {
    label: "Rounds",
    columns: [
      "round", "label", "phase", "status", "demand_share", "demand_spread", "demand_low", "demand_high", "demand_mw",
      "market_price", "marginal_price", "served_mw", "opened_at", "deadline", "closed_at",
    ],
  },
  groups: {
    label: "Teams",
    columns: ["slot", "name", "code", "technology", "joined_at", "active"],
  },
};
