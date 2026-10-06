// Turns the raw rows returned by the database functions into the view models
// the screens use. The database has already removed anything the caller may
// not see (codes, costs, open offers of other teams).
import type { Phase } from "./game";
import type { BidView, GroupState, GroupView, RoundView, SessionView } from "./types";

export type Row = Record<string, unknown>;

export interface Bundle {
  session: Row;
  groups: Row[];
  rounds: Row[];
  bids: Row[];
  totals: Row[]; // cumulative earnings per team, practice excluded
  serverTime: string;
}

export interface GroupBundle extends Bundle {
  me: Row;
  myOpenBids: Row[];
  myTotal: number;
  myRank: number;
}

const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
const num = (v: unknown) => (v == null ? null : Number(v));

function toGroup(r: Row): GroupView {
  const slot = Number(r.slot);
  return {
    id: Number(r.id),
    slot,
    code: r.code == null ? undefined : String(r.code),
    name: (r.name as string) ?? null,
    displayName: (r.name as string) || `Team ${slot}`,
    technology: String(r.technology),
    icon: String(r.icon),
    capacity: Number(r.capacity),
    joined: r.joined_at != null,
    active: r.active !== false,
    playing: false, // set by markPlaying
  };
}

/**
 * Teams that count towards demand: active teams that have shown up, or every
 * active team if nobody has yet. Mirrors _playing_capacity() in schema.sql.
 */
function markPlaying(groups: GroupView[]) {
  const shown = groups.filter((g) => g.active && g.joined);
  const playing = new Set((shown.length ? shown : groups.filter((g) => g.active)).map((g) => g.id));
  return groups.map((g) => ({ ...g, playing: playing.has(g.id) }));
}

function toBid(r: Row): BidView {
  return {
    groupId: Number(r.group_id),
    anonLabel: (r.anon as string) ?? null,
    price: Number(r.price),
    quantity: Number(r.quantity),
    revisions: Number(r.revisions ?? 1),
    submittedAt: iso(r.submitted_at) ?? "",
    dispatched: num(r.dispatched),
    profit: num(r.profit),
  };
}

function toRound(r: Row, totalCapacity: number, cap: number, bids: Row[], admin: boolean): RoundView {
  const status = r.status as RoundView["status"];
  const mine = bids.filter((b) => Number(b.round_id) === Number(r.id));
  const spread = Number(r.demand_spread ?? 0);
  // Pending rounds preview the range with the teams playing now; opened rounds use the frozen draw.
  // Same rule as the database (admin_action → openRound): the top of the range never exceeds the cap.
  const base = Math.round(Number(r.demand_share) * totalCapacity);
  const uncappedHigh = Math.round(base * (1 + spread));
  const high = r.demand_high != null ? Number(r.demand_high) : Math.min(uncappedHigh, cap);
  const low = r.demand_low != null ? Number(r.demand_low) : Math.min(Math.round(base * (1 - spread)), high);
  const known = r.demand_mw != null;
  return {
    id: Number(r.id),
    number: Number(r.number),
    label: String(r.label),
    phase: r.phase as Phase,
    status,
    demandShare: Number(r.demand_share),
    demandSpread: spread,
    demandMw: known ? Number(r.demand_mw) : status === "pending" ? Math.min(base, cap) : Math.round((low + high) / 2),
    demandLow: low,
    demandHigh: high,
    demandKnown: known || (status === "pending" && spread === 0),
    demandCapped: status === "pending" && uncappedHigh > cap,
    openedAt: iso(r.opened_at),
    deadline: iso(r.deadline),
    closedAt: iso(r.closed_at),
    clearingPrice: num(r.clearing_price),
    marginalPrice: num(r.marginal_price),
    servedMw: num(r.served_mw),
    submittedGroupIds: mine.map((b) => Number(b.group_id)),
    bids: admin || status === "closed" ? mine.map(toBid) : [],
  };
}

/**
 * Cumulative profit over closed rounds, practice excluded, as summed by the
 * database (Part 1 offers are anonymous, so they cannot be added up here).
 * Unused cards are left out.
 */
function leaderboard(groups: GroupView[], totalsRows: Row[]) {
  const totals = new Map(groups.filter((g) => g.joined).map((g) => [g.id, 0]));
  for (const t of totalsRows) {
    const id = Number(t.group_id);
    if (totals.has(id)) totals.set(id, Number(t.profit));
  }
  return [...totals.entries()]
    .map(([groupId, profit]) => ({ groupId, profit: Math.round(profit * 100) / 100 }))
    .sort((a, b) => b.profit - a.profit);
}

export function sessionView(b: Bundle, admin: boolean): SessionView {
  const s = b.session;
  const groups = markPlaying(b.groups.map(toGroup));
  const playing = groups.filter((g) => g.playing);
  const playingCapacity = playing.reduce((sum, g) => sum + g.capacity, 0);
  // Mirrors _demand_cap() in schema.sql: always leave the largest plant's worth unsold.
  const cap = playing.length >= 2 ? playingCapacity - Math.max(...playing.map((g) => g.capacity)) : playingCapacity;
  // Pending rounds preview their demand with the teams playing right now.
  const rounds = b.rounds.map((r) => toRound(r, playingCapacity, cap, b.bids, admin));
  return {
    id: String(s.id),
    name: String(s.name),
    priceCap: Number(s.price_cap),
    roundSeconds: Number(s.round_seconds),
    playingCapacity,
    playingCount: playing.length,
    groups,
    rounds,
    leaderboard: leaderboard(groups, b.totals ?? []),
    rankingPublic: admin || rounds.some((r) => r.phase === "collusion" && r.status !== "pending"),
    serverTime: iso(b.serverTime)!,
  };
}

export function groupState(b: GroupBundle): GroupState {
  const session = sessionView(b, false);
  const group = {
    ...toGroup(b.me),
    playing: session.groups.find((g) => g.id === Number(b.me.id))?.playing ?? false,
  };
  const groupId = group.id;

  const open = session.rounds.find((r) => r.status === "open");
  const lastClosed = [...session.rounds].reverse().find((r) => r.status === "closed");
  const currentRound = open ?? lastClosed ?? null;
  let current: GroupState["current"] = null;
  if (currentRound) {
    const mine = open
      ? b.myOpenBids.find((x) => Number(x.round_id) === open.id)
      : b.bids.find((x) => Number(x.round_id) === currentRound.id && Number(x.group_id) === groupId);
    current = { ...currentRound, myBid: mine ? toBid(mine) : null };
  }

  const history = session.rounds
    .filter((r) => r.status === "closed")
    .map((r) => {
      const bid = r.bids.find((x) => x.groupId === groupId);
      return {
        roundId: r.id,
        number: r.number,
        label: r.label,
        phase: r.phase,
        demandMw: r.demandMw,
        clearingPrice: r.clearingPrice ?? 0,
        marginalPrice: r.marginalPrice ?? r.clearingPrice ?? 0,
        myPrice: bid?.price ?? null,
        myQuantity: bid?.quantity ?? null,
        accepted: (bid?.dispatched ?? 0) > 0,
        dispatched: bid?.dispatched ?? 0,
        profit: bid?.profit ?? 0,
      };
    });
  // Own total and position come from the database: other teams' totals are not shared during Part 1.
  const hasScores = session.rounds.some((r) => r.status === "closed" && r.phase !== "practice");

  return {
    session: {
      id: session.id,
      name: session.name,
      priceCap: session.priceCap,
      playingCount: session.playingCount,
      playingCapacity: session.playingCapacity,
    },
    group,
    groups: session.groups,
    current,
    history,
    totalProfit: Number(b.myTotal ?? 0),
    rank: hasScores ? Number(b.myRank) : null,
    serverTime: session.serverTime,
  };
}
