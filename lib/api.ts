// Browser → Supabase. Every call is a Postgres function exposed by PostgREST
// (see supabase/schema.sql); there is no server of our own.
import type { PanelInput } from "./analysis.ts";
import type { GroupState, ScreenSession, SessionSummary, SessionView } from "./types";
import { groupState, sessionView, type Bundle, type GroupBundle, type Row } from "./views";

const URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  (process.env.NODE_ENV === "development" ? "http://localhost:54321" : "");
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "local-dev";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number, // 401 login needed, 404 not found, 400 other
  ) {
    super(message);
  }
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!URL) throw new ApiError("The app is not connected to a database (NEXT_PUBLIC_SUPABASE_URL is missing).", 500);
  let res: Response;
  try {
    res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: KEY,
        // Legacy anon keys are JWTs and also go in Authorization; new publishable keys do not.
        ...(KEY.startsWith("eyJ") ? { Authorization: `Bearer ${KEY}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      cache: "no-store",
    });
  } catch {
    throw new ApiError("No connection. Check the Wi-Fi and try again.", 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const status = data?.hint === "auth" ? 401 : data?.hint === "not_found" ? 404 : 400;
    if (status === 401) clearToken();
    throw new ApiError(data?.message ?? "Request failed", status);
  }
  return data as T;
}

// ---------------------------------------------------------------- instructor token

const TOKEN_KEY = "market-game:admin-token";

function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

// ---------------------------------------------------------------- calls

export const api = {
  groupState: (code: string) => rpc<GroupBundle>("group_state", { p_code: code }).then(groupState),

  rename: (code: string, name: string) =>
    rpc<GroupBundle>("group_rename", { p_code: code, p_name: name }).then(groupState),

  bid: (code: string, bid: { roundId: number; price: number }): Promise<GroupState> =>
    rpc<GroupBundle>("group_bid", { p_code: code, p_round: bid.roundId, p_price: bid.price }).then(groupState),

  screen: (id: string) => rpc<Bundle>("screen_state", { p_session: id }).then((b) => sessionView(b, false)),

  screenSessions: () => rpc<ScreenSession[]>("screen_sessions", {}),

  /** Panel for Part 3; available once a Part 2 round has been played. */
  analysis: (id: string) =>
    rpc<{ available: boolean } & Partial<PanelInput>>("analysis_state", { p_session: id }),

  async login(password: string) {
    const { token } = await rpc<{ token: string }>("admin_login", { p_password: password });
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {}
  },

  sessions: () => rpc<SessionSummary[]>("admin_sessions", { p_token: getToken() }),

  createSession: (f: { name: string; groups: number; priceCap: number; roundSeconds: number }) =>
    rpc<{ id: string }>("admin_create_session", {
      p_token: getToken(),
      p_name: f.name,
      p_groups: f.groups,
      p_price_cap: f.priceCap,
      p_round_seconds: f.roundSeconds,
    }),

  session: (id: string): Promise<SessionView> =>
    rpc<Bundle>("admin_session", { p_token: getToken(), p_session: id }).then((b) => sessionView(b, true)),

  action: (id: string, action: Record<string, unknown>): Promise<SessionView> =>
    rpc<Bundle>("admin_action", { p_token: getToken(), p_session: id, p_action: action }).then((b) =>
      sessionView(b, true),
    ),

  exportRows: (id: string, file: string) =>
    rpc<Row[]>("admin_export", { p_token: getToken(), p_session: id, p_file: file }),
};

/** Prefix for links and assets when the site lives in a sub-folder (GitHub Pages). */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
