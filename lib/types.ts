import type { Phase, RoundStatus } from "./game";

export interface GroupView {
  id: number;
  slot: number;
  code?: string; // admin only
  name: string | null;
  displayName: string;
  technology: string;
  icon: string;
  capacity: number; // 100 MW for every plant
  joined: boolean; // opened its page or bid
  active: boolean; // false once the instructor pauses the team
  playing: boolean; // counts towards demand (see _playing_capacity in schema.sql)
}

export interface BidView {
  groupId: number; // negative for an anonymous offer (Part 1, another team)
  anonLabel: string | null; // "A", "B"… for anonymous offers, reshuffled every round
  price: number;
  quantity: number;
  revisions: number;
  submittedAt: string;
  dispatched: number | null;
  profit: number | null;
}

export interface RoundView {
  id: number;
  number: number;
  label: string;
  phase: Phase;
  status: RoundStatus;
  demandShare: number;
  demandSpread: number; // 0 = known exactly; 0.1 = forecast ±10%, real value drawn at opening
  demandMw: number; // real demand (or the midpoint of the forecast while it is hidden)
  demandLow: number; // forecast range shown to teams (equal to demandMw when exact)
  demandHigh: number;
  demandKnown: boolean; // false while the real value of an uncertain round is hidden
  demandCapped: boolean; // pending preview hit the cap (playing capacity minus the largest plant)
  openedAt: string | null;
  deadline: string | null;
  closedAt: string | null;
  clearingPrice: number | null; // market price: average paid, weighted by MWh
  marginalPrice: number | null; // highest accepted offer
  servedMw: number | null;
  submittedGroupIds: number[];
  bids: BidView[]; // closed rounds, or every round for the admin
}

export interface SessionView {
  id: string;
  name: string;
  priceCap: number;
  roundSeconds: number;
  playingCapacity: number; // MW of the teams that count towards demand
  playingCount: number;
  groups: GroupView[];
  rounds: RoundView[];
  leaderboard: { groupId: number; profit: number }[];
  rankingPublic: boolean; // named totals are only shared once Part 2 has started (Part 1 is anonymous)
  serverTime: string;
}

export interface GroupRoundResult {
  roundId: number;
  number: number;
  label: string;
  phase: Phase;
  demandMw: number;
  clearingPrice: number;
  marginalPrice: number;
  myPrice: number | null;
  myQuantity: number | null;
  accepted: boolean;
  dispatched: number;
  profit: number;
}

export interface GroupState {
  session: { id: string; name: string; priceCap: number; playingCount: number; playingCapacity: number };
  group: GroupView;
  groups: GroupView[]; // every team, public view (for the merit order chart)
  current: (RoundView & { myBid: BidView | null }) | null;
  history: GroupRoundResult[];
  totalProfit: number;
  rank: number | null;
  serverTime: string;
}

/** What the projector's session picker may know about a session. */
export interface ScreenSession {
  id: string;
  name: string;
  createdAt: string;
  teamsJoined: number;
  roundsPlayed: number;
}

export interface SessionSummary {
  id: string;
  name: string;
  createdAt: string;
  groupCount: number;
  closedRounds: number;
}
