// Shared game vocabulary for the web app, plus the reference implementation
// of the market clearing. The clearing that counts runs in Postgres
// (_clear_market in supabase/schema.sql); scripts/db.test.mjs checks that both
// give the same results. The plant names and default rounds live in the SQL too.
//
// The game is pay-as-bid: every plant is 100 MW with no production cost, and
// each team that sells is paid the price it offered.

export type Phase = "practice" | "competition" | "collusion";

export type RoundStatus = "pending" | "open" | "closed";

// Shown to students: Part 1 must not hint that agreements come later.
export const PHASE_LABEL: Record<Phase, string> = {
  practice: "Practice",
  competition: "Part 1",
  collusion: "Part 2 · Agreements allowed",
};

export interface Offer {
  groupId: number;
  price: number;
  quantity: number;
}

export interface ClearingResult {
  /** Market price: the average price paid, weighted by MWh. */
  clearingPrice: number;
  /** Highest accepted offer. */
  marginalPrice: number;
  servedMw: number;
  shortfallMw: number;
  dispatch: { groupId: number; dispatched: number; profit: number }[];
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Pay-as-bid auction with inelastic demand. Offers are accepted from cheapest
 * to most expensive until demand is met; ties at the margin share the
 * remaining demand pro rata (so a cartel that all bids the same price shares
 * the market). Every accepted team is paid its own offer; with no production
 * costs, its profit is its revenue.
 */
export function clearMarket(demand: number, offers: Offer[]): ClearingResult {
  const valid = offers.filter((o) => o.quantity > 0);
  const levels = [...new Set(valid.map((o) => o.price))].sort((a, b) => a - b);
  const dispatched = new Map<number, number>();
  let remaining = demand;
  let marginalPrice = 0;

  for (const price of levels) {
    if (remaining <= 0) break;
    const atLevel = valid.filter((o) => o.price === price);
    const total = atLevel.reduce((s, o) => s + o.quantity, 0);
    const ratio = Math.min(1, remaining / total);
    for (const o of atLevel) dispatched.set(o.groupId, o.quantity * ratio);
    remaining -= total * ratio;
    marginalPrice = price;
  }

  const shortfall = remaining > 1e-9 ? remaining : 0;
  const served = demand - shortfall;
  const revenue = offers.reduce((s, o) => s + o.price * (dispatched.get(o.groupId) ?? 0), 0);

  return {
    clearingPrice: round2(served > 0 ? revenue / served : 0),
    marginalPrice: round2(marginalPrice),
    servedMw: round2(served),
    shortfallMw: round2(shortfall),
    dispatch: offers.map((o) => {
      const q = dispatched.get(o.groupId) ?? 0;
      return { groupId: o.groupId, dispatched: round2(q), profit: round2(o.price * q) };
    }),
  };
}
