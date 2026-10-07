// Tests for supabase/schema.sql, run on PGlite: npm test
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { clearMarket } from "../lib/game.ts";
import { callRpc, openDatabase } from "./local-db.mjs";

let db;
let token;
const rpc = (fn, args) => callRpc(db, fn, args);
const admin = (fn, args = {}) => rpc(fn, { p_token: token, ...args });
const act = (session, action) => admin("admin_action", { p_session: session, p_action: action });

before(async () => {
  db = await openDatabase(undefined, "secret-pw");
  ({ token } = await rpc("admin_login", { p_password: "secret-pw" }));
});

async function newSession(groups = 4) {
  const { id } = await admin("admin_create_session", {
    p_name: "test",
    p_groups: groups,
    p_price_cap: 200,
    p_round_seconds: 120,
  });
  const s = await admin("admin_session", { p_session: id });
  return { id, groups: s.groups, rounds: s.rounds };
}

// ---------------------------------------------------------------- clearing: SQL == TypeScript

test("SQL clearing matches the TypeScript reference on 300 random markets", async () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let i = 0; i < 300; i++) {
    const n = 1 + Math.floor(rand() * 9);
    const offers = Array.from({ length: n }, (_, k) => ({
      groupId: k + 1,
      // Few distinct prices so ties are common.
      price: [0, 20, 35.5, 50, 80, 120, 199, 200][Math.floor(rand() * 8)],
      quantity: [0, 40, 60, 100, 150][Math.floor(rand() * 5)],
    }));
    const demand = Math.round(rand() * 900);
    const ts = clearMarket(demand, offers);
    const { rows } = await db.query("select _clear_market($1, $2::jsonb) as r", [demand, JSON.stringify(offers)]);
    const sql = rows[0].r;
    const ctx = `demand=${demand} offers=${JSON.stringify(offers)}`;
    for (const k of ["clearingPrice", "marginalPrice", "servedMw", "shortfallMw"])
      assert.ok(Math.abs(Number(sql[k]) - ts[k]) <= 0.011, `${k}: sql ${sql[k]} vs ts ${ts[k]} (${ctx})`);
    ts.dispatch.forEach((d, j) => {
      const row = sql.dispatch[j];
      assert.equal(row.groupId, d.groupId);
      for (const k of ["dispatched", "profit"])
        assert.ok(Math.abs(Number(row[k]) - d[k]) <= 0.011, `${k} group ${d.groupId}: sql ${row[k]} vs ts ${d[k]} (${ctx})`);
    });
  }
});

// ---------------------------------------------------------------- security

test("tables and internal functions are closed to the public API role", async () => {
  for (const t of ["sessions", "groups", "rounds", "bids", "bid_log", "app_config", "admin_tokens"]) {
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.exec("set local role anon");
        await tx.query(`select * from ${t}`);
      }),
      /permission denied/,
      t,
    );
  }
  await assert.rejects(rpc("set_admin_password", { p_password: "hacked" }), /permission denied/);
  await assert.rejects(rpc("_clear_market", { p_demand: 1, p_offers: [] }), /permission denied/);
  await assert.rejects(rpc("_bundle", { p_session: "x", p_admin: true }), /permission denied/);
});

test("instructor functions need a valid token", async () => {
  await assert.rejects(rpc("admin_login", { p_password: "nope" }), /Wrong password/);
  await assert.rejects(rpc("admin_sessions", { p_token: "made-up" }), /Instructor login required/);
  await assert.rejects(rpc("admin_session", { p_token: "", p_session: "x" }), /Instructor login required/);
});

test("teams and the projector never see codes or open offers of others", async () => {
  const s = await newSession(3);
  const [a, b] = s.groups;
  await act(s.id, { action: "openRound", roundId: s.rounds[1].id });
  await rpc("group_bid", { p_code: a.code, p_round: s.rounds[1].id, p_price: 42 });

  const seenByB = await rpc("group_state", { p_code: b.code.toLowerCase() });
  assert.equal(seenByB.me.code, b.code);
  for (const g of seenByB.groups) assert.equal(g.code, undefined);
  assert.deepEqual(Object.keys(seenByB.bids[0]).sort(), ["group_id", "round_id"]); // only "has bid"

  const screen = await rpc("screen_state", { p_session: s.id });
  assert.ok(screen.groups.every((g) => g.code === undefined));
  assert.equal(screen.bids[0].price, undefined);
});

// ---------------------------------------------------------------- a full round

test("pay-as-bid: identical plants, own price paid, cartel undercut", async () => {
  const s = await newSession(4);
  assert.deepEqual(new Set(s.groups.map((g) => g.capacity)), new Set([100]));
  // Nothing of the former pay-as-clear version is left.
  assert.ok(s.groups.every((g) => !("marginal_cost" in g)));
  const { session } = await admin("admin_session", { p_session: s.id });
  assert.ok(!("mode" in session) && !("reveal_costs" in session));
  assert.equal(s.rounds.length, 15);
  assert.deepEqual(
    s.rounds.map((r) => r.phase),
    ["practice", ...Array(7).fill("competition"), ...Array(7).fill("collusion")],
  );

  // 85% of 400 MW = 340, capped at 300 MW so one plant is always left over.
  const round = s.rounds.find((r) => r.phase === "collusion" && r.demand_share === 0.85);
  await act(s.id, { action: "openRound", roundId: round.id });
  const prices = [199, 200, 200, 200];
  for (const [i, g] of s.groups.entries())
    await rpc("group_bid", { p_code: g.code, p_round: round.id, p_price: prices[i] });
  // A team may change its mind while the round is open.
  await rpc("group_bid", { p_code: s.groups[3].code, p_round: round.id, p_price: 200 });

  const after = await act(s.id, { action: "closeRound", roundId: round.id });
  const r = after.rounds.find((x) => x.id === round.id);
  const bids = Object.fromEntries(after.bids.filter((b) => b.round_id === round.id).map((b) => [b.group_id, b]));
  const [cheater, , , last] = s.groups;
  assert.equal(r.demand_mw, 300);
  assert.equal(bids[cheater.id].quantity, 100); // quantity is always the whole plant
  assert.equal(bids[cheater.id].dispatched, 100);
  assert.equal(bids[cheater.id].profit, 19900);
  assert.equal(bids[last.id].dispatched, 66.67); // the cartel shares the remaining 200 MW
  assert.equal(bids[last.id].revisions, 2);
  assert.equal(r.marginal_price, 200);
  assert.equal(r.clearing_price, Math.round(((199 * 100 + 200 * 200) / 300) * 100) / 100);

  await assert.rejects(
    rpc("group_bid", { p_code: cheater.code, p_round: round.id, p_price: 1 }),
    /This round is closed/,
  );
  const log = await admin("admin_export", { p_session: s.id, p_file: "bid_log" });
  assert.equal(log.length, 5);
  const results = await admin("admin_export", { p_session: s.id, p_file: "results" });
  assert.equal(results.length, 4);
  assert.equal(results.find((x) => x.group_slot === 1).paid_price, 199);
});

// ---------------------------------------------------------------- instructor actions

test("instructor actions and validation", async () => {
  const s = await newSession(2);
  const [r1, r2] = s.rounds;
  await assert.rejects(rpc("group_bid", { p_code: s.groups[0].code, p_round: r1.id, p_price: 5 }), /closed/);
  await act(s.id, { action: "openRound", roundId: r1.id });
  await assert.rejects(act(s.id, { action: "openRound", roundId: r2.id }), /still open/);
  await assert.rejects(rpc("group_bid", { p_code: s.groups[0].code, p_round: r1.id, p_price: 250 }), /between 0 and 200/);
  await assert.rejects(rpc("group_bid", { p_code: "ZZZZZ", p_round: r1.id, p_price: 5 }), /Unknown group code/);
  await rpc("group_bid", { p_code: s.groups[0].code, p_round: r1.id, p_price: 50 });
  await assert.rejects(act(s.id, { action: "removeGroup", groupId: s.groups[0].id }), /already bid/);

  let st = await act(s.id, { action: "addGroup" });
  assert.equal(st.groups.length, 3);
  assert.equal(st.groups[2].technology, "Wind");
  st = await act(s.id, { action: "removeGroup", groupId: st.groups[2].id });
  assert.equal(st.groups.length, 2);

  await act(s.id, { action: "closeRound", roundId: r1.id });
  st = await act(s.id, { action: "resetRound", roundId: r1.id });
  assert.equal(st.rounds[0].status, "pending");
  assert.equal(st.bids.length, 0);

  st = await act(s.id, { action: "updateRound", roundId: r2.id, demandShare: 0.3, label: "Late night", phase: "collusion" });
  assert.deepEqual([st.rounds[1].label, st.rounds[1].phase, st.rounds[1].demand_share], ["Late night", "collusion", 0.3]);
  await assert.rejects(act(s.id, { action: "updateRound", roundId: r2.id, demandShare: 3 }), /Demand must be/);
  st = await act(s.id, { action: "addRound", label: "18:00", phase: "competition", demandShare: 0.5 });
  assert.equal(st.rounds.at(-1).number, 16);
  st = await act(s.id, { action: "renameGroup", groupId: s.groups[0].id, name: "  Los   Atómicos  " });
  assert.equal(st.groups[0].name, "Los Atómicos");
  const renamed = await rpc("group_rename", { p_code: s.groups[1].code, p_name: "Team Sol" });
  assert.equal(renamed.me.name, "Team Sol");
  const list = await admin("admin_sessions");
  assert.ok(list.some((x) => x.id === s.id));
});

test("plant names: the first 12 differ, then they repeat as III, IV…", async () => {
  const { rows } = await db.query(
    "select (_technology(1)).technology a, (_technology(13)).technology b, (_technology(22)).technology c, (_technology(25)).technology d",
  );
  assert.deepEqual(rows[0], { a: "Nuclear", b: "Nuclear III", c: "Combined-cycle gas III", d: "Nuclear IV" });
});

test("the schema can be run again on a live database without losing data", async () => {
  const fs = await import("node:fs");
  const s = await newSession(2);
  await db.exec(fs.readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8"));
  const again = await admin("admin_session", { p_session: s.id });
  assert.equal(again.groups.length, 2);
});

// ---------------------------------------------------------------- turnout

test("demand follows the teams that show up; paused teams drop out", async () => {
  const s = await newSession(6); // 6 teams created, 4 of them used
  const [a, b, c, d, unused1, unused2] = s.groups;
  const byNumber = (st, n) => st.rounds.find((r) => r.number === n);

  // Nobody has shown up yet: a dry run counts every team (60% of 600 MW).
  let st = await act(s.id, { action: "openRound", roundId: byNumber(s, 1).id });
  assert.equal(byNumber(st, 1).demand_mw, 360);
  await act(s.id, { action: "resetRound", roundId: byNumber(s, 1).id });

  // Three teams have opened their page when the round opens: 60% of 300 MW.
  for (const g of [a, b, c]) await rpc("group_state", { p_code: g.code });
  st = await act(s.id, { action: "openRound", roundId: byNumber(s, 1).id });
  assert.equal(byNumber(st, 1).demand_mw, 180);
  // A late fourth team bids straight away; from now on it counts too.
  await rpc("group_bid", { p_code: d.code, p_round: byNumber(s, 1).id, p_price: 10 });
  for (const g of [a, b, c]) await rpc("group_bid", { p_code: g.code, p_round: byNumber(s, 1).id, p_price: 50 });
  st = await act(s.id, { action: "closeRound", roundId: byNumber(s, 1).id });
  assert.equal(st.groups.find((g) => g.id === d.id).joined_at != null, true);
  assert.equal(st.groups.find((g) => g.id === unused1.id).joined_at, null);

  // Team d leaves mid-game: paused, it no longer counts nor can bid.
  st = await act(s.id, { action: "setActive", groupId: d.id, active: false });
  assert.equal(st.groups.find((g) => g.id === d.id).active, false);
  st = await act(s.id, { action: "openRound", roundId: byNumber(s, 2).id }); // 45% of 300
  assert.equal(byNumber(st, 2).demand_mw, 135);
  await assert.rejects(
    rpc("group_bid", { p_code: d.code, p_round: byNumber(s, 2).id, p_price: 5 }),
    /paused/,
  );

  // A team paused after bidding in an open round is left out of that round's clearing.
  await rpc("group_bid", { p_code: a.code, p_round: byNumber(s, 2).id, p_price: 20 });
  await rpc("group_bid", { p_code: b.code, p_round: byNumber(s, 2).id, p_price: 30 });
  await act(s.id, { action: "setActive", groupId: a.id, active: false });
  st = await act(s.id, { action: "closeRound", roundId: byNumber(s, 2).id });
  const r2 = st.bids.filter((x) => x.round_id === byNumber(s, 2).id);
  assert.equal(r2.find((x) => x.group_id === a.id).dispatched, null);
  assert.equal(r2.find((x) => x.group_id === b.id).dispatched, 100); // only b offered: 100 of 135 MW
  await act(s.id, { action: "setActive", groupId: a.id, active: true });

  // Teams nobody used can simply be removed.
  st = await act(s.id, { action: "removeGroup", groupId: unused1.id });
  st = await act(s.id, { action: "removeGroup", groupId: unused2.id });
  assert.equal(st.groups.length, 4);
});

// ---------------------------------------------------------------- demand uncertainty

test("uncertain demand: teams see a forecast range, the real value is drawn and revealed at close", async () => {
  const s = await newSession(10); // 1000 MW; round 3 is 60% → base 600 MW
  const [a, b] = s.groups;
  const r3 = s.rounds.find((r) => r.number === 3);
  await assert.rejects(act(s.id, { action: "updateRound", roundId: r3.id, demandSpread: 0.8 }), /Uncertainty/);
  let st = await act(s.id, { action: "updateRound", roundId: r3.id, demandSpread: 0.05 });
  assert.equal(st.rounds.find((r) => r.id === r3.id).demand_spread, 0.05);

  st = await act(s.id, { action: "openRound", roundId: r3.id });
  const opened = st.rounds.find((r) => r.id === r3.id);
  assert.deepEqual([opened.demand_low, opened.demand_high], [570, 630]);
  assert.ok(opened.demand_mw >= 570 && opened.demand_mw <= 630 && Number.isInteger(opened.demand_mw));

  // While open, teams and the projector only get the range.
  const team = await rpc("group_state", { p_code: a.code });
  const seen = team.rounds.find((r) => r.id === r3.id);
  assert.equal(seen.demand_mw, undefined);
  assert.deepEqual([seen.demand_low, seen.demand_high], [570, 630]);
  const screen = await rpc("screen_state", { p_session: s.id });
  assert.equal(screen.rounds.find((r) => r.id === r3.id).demand_mw, undefined);

  await rpc("group_bid", { p_code: b.code, p_round: r3.id, p_price: 50 });
  await act(s.id, { action: "closeRound", roundId: r3.id });
  const after = await rpc("group_state", { p_code: a.code });
  assert.equal(after.rounds.find((r) => r.id === r3.id).demand_mw, opened.demand_mw); // revealed
  for (const g of s.groups) await rpc("group_state", { p_code: g.code }); // all 10 teams are playing

  // The draw really varies, and rounds without uncertainty stay exact.
  const draws = new Set();
  for (let i = 0; i < 15; i++) {
    await act(s.id, { action: "resetRound", roundId: r3.id });
    st = await act(s.id, { action: "openRound", roundId: r3.id });
    draws.add(st.rounds.find((r) => r.id === r3.id).demand_mw);
    await act(s.id, { action: "closeRound", roundId: r3.id });
  }
  assert.ok(draws.size > 3, `only ${draws.size} distinct draws`);
  const r4 = s.rounds.find((r) => r.number === 4);
  st = await act(s.id, { action: "openRound", roundId: r4.id });
  const exact = st.rounds.find((r) => r.id === r4.id);
  assert.deepEqual([exact.demand_low, exact.demand_mw, exact.demand_high], [700, 700, 700]); // round 4: 70%, exact
  assert.equal((await rpc("screen_state", { p_session: s.id })).rounds.find((r) => r.id === r4.id).demand_mw, 700);
  await act(s.id, { action: "closeRound", roundId: r4.id });

  st = await act(s.id, { action: "setSpreadAll", demandSpread: 0.1 });
  assert.ok(st.rounds.filter((r) => r.status === "pending").every((r) => r.demand_spread === 0.1));
  assert.equal(st.rounds.find((r) => r.id === r4.id).demand_spread, 0); // played rounds untouched
});

test("the projector can list recent sessions without a password, and nothing secret", async () => {
  const s = await newSession(3);
  await rpc("group_state", { p_code: s.groups[0].code });
  const list = await rpc("screen_sessions");
  const mine = list.find((x) => x.id === s.id);
  assert.deepEqual(Object.keys(mine).sort(), ["createdAt", "id", "name", "roundsPlayed", "teamsJoined"]);
  assert.equal(mine.teamsJoined, 1);
  assert.equal(list[0].id, s.id); // newest first
});

test("before Part 2 starts, phones and projector receive nothing about agreements", async () => {
  const s = await newSession(3);
  const first = s.rounds.find((r) => r.phase === "competition");
  await act(s.id, { action: "openRound", roundId: first.id });
  const team = await rpc("group_state", { p_code: s.groups[0].code });
  const screen = await rpc("screen_state", { p_session: s.id });
  for (const payload of [team, screen]) {
    assert.deepEqual(payload.rounds.map((r) => r.id), [first.id]); // upcoming rounds are not sent
    assert.ok(!JSON.stringify(payload).includes("collusion"));
  }
  const plan = await admin("admin_session", { p_session: s.id });
  assert.equal(plan.rounds.length, 15); // the instructor still sees the whole plan
});

// ---------------------------------------------------------------- demand cap

test("demand never covers every plant: at least one is left over", async () => {
  const s = await newSession(4);
  for (const g of s.groups) await rpc("group_state", { p_code: g.code });
  const peak = s.rounds.find((r) => r.phase === "competition" && r.demand_share === 0.85); // 340 of 400
  let st = await act(s.id, { action: "updateRound", roundId: peak.id, demandSpread: 0.1 });
  st = await act(s.id, { action: "openRound", roundId: peak.id });
  const r = st.rounds.find((x) => x.id === peak.id);
  assert.deepEqual([r.demand_low, r.demand_high], [300, 300]); // 306–374 capped to 300
  assert.equal(r.demand_mw, 300);

  // With distinct prices the most expensive team sells nothing.
  for (const [i, g] of s.groups.entries()) await rpc("group_bid", { p_code: g.code, p_round: peak.id, p_price: 50 + i });
  st = await act(s.id, { action: "closeRound", roundId: peak.id });
  const sold = s.groups.map((g) => st.bids.find((b) => b.round_id === peak.id && b.group_id === g.id).dispatched);
  assert.deepEqual(sold, [100, 100, 100, 0]);

  // Ten teams at 85%: 850 MW is already below the cap of 900, nothing changes.
  const big = await newSession(10);
  for (const g of big.groups) await rpc("group_state", { p_code: g.code });
  const bigPeak = big.rounds.find((x) => x.phase === "competition" && x.demand_share === 0.85);
  st = await act(big.id, { action: "updateRound", roundId: bigPeak.id, demandSpread: 0.1 });
  st = await act(big.id, { action: "openRound", roundId: bigPeak.id });
  const rb = st.rounds.find((x) => x.id === bigPeak.id);
  assert.deepEqual([rb.demand_low, rb.demand_high], [765, 900]); // 765–935, top capped at 900

  // A lone team is not capped to zero.
  const solo = await newSession(1);
  st = await act(solo.id, { action: "openRound", roundId: solo.rounds[1].id });
  assert.equal(st.rounds[1].demand_mw, 45);
});

// ---------------------------------------------------------------- anonymity in Part 1

test("Part 1 offers are anonymous (reshuffled letters); Part 2 shows names", async () => {
  const s = await newSession(10);
  for (const g of s.groups) await rpc("group_state", { p_code: g.code });
  const [me, other] = s.groups;
  const play = async (round, priceOf) => {
    await act(s.id, { action: "openRound", roundId: round.id });
    for (const [i, g] of s.groups.entries()) await rpc("group_bid", { p_code: g.code, p_round: round.id, p_price: priceOf(i) });
    await act(s.id, { action: "closeRound", roundId: round.id });
  };
  const [r2, r3] = s.rounds.filter((r) => r.phase === "competition");
  const r6 = s.rounds.find((r) => r.phase === "collusion");
  await play(r2, (i) => 50 + i);
  // During Part 1 nobody but the instructor gets named totals; each team gets its own.
  const early = await rpc("screen_state", { p_session: s.id });
  assert.deepEqual(early.totals, []);
  const lastTeam = await rpc("group_state", { p_code: s.groups[9].code });
  assert.ok(lastTeam.totals.length === 0 && typeof lastTeam.myTotal === "number" && lastTeam.myRank >= 1);
  const firstTeam = await rpc("group_state", { p_code: me.code });
  const adminNow = await admin("admin_session", { p_session: s.id });
  const totalsNow = Object.fromEntries(adminNow.totals.map((t) => [t.group_id, t.profit]));
  assert.equal(firstTeam.myTotal, totalsNow[me.id]);
  assert.equal(firstTeam.myRank, 1 + Object.values(totalsNow).filter((v) => v > totalsNow[me.id]).length);
  await play(r3, (i) => 50 + i);
  await play(r6, (i) => (i === 0 ? 199 : 200));

  const mine = await rpc("group_state", { p_code: me.code });
  const theirs = await rpc("group_state", { p_code: other.code });
  const screen = await rpc("screen_state", { p_session: s.id });
  const inRound = (payload, round) => payload.bids.filter((b) => b.round_id === round.id);

  // Part 1: my own offer keeps my id; everyone else is a letter with no id, time or revisions.
  const p1 = inRound(mine, r2);
  assert.equal(p1.filter((b) => b.group_id === me.id).length, 1);
  const anon = p1.filter((b) => b.group_id !== me.id);
  assert.equal(anon.length, 9);
  assert.ok(anon.every((b) => b.group_id < 0 && /^[A-J]$/.test(b.anon) && b.id === undefined && b.submitted_at === undefined));
  assert.ok(inRound(screen, r2).every((b) => b.group_id < 0)); // the projector sees no names at all

  // The same team has the same letter on every screen within a round…
  const letterByPrice = (payload, round) => Object.fromEntries(inRound(payload, round).filter((b) => b.anon).map((b) => [b.price, b.anon]));
  const seenByMe = letterByPrice(mine, r2);
  const seenByScreen = letterByPrice(screen, r2);
  for (const [price, letter] of Object.entries(seenByMe)) assert.equal(seenByScreen[price], letter);
  // …and letters are reshuffled between rounds (same prices in r2 and r3).
  assert.notDeepEqual(letterByPrice(screen, r2), letterByPrice(screen, r3));

  // Part 2: names are visible to everyone.
  assert.deepEqual(inRound(theirs, r6).map((b) => b.group_id).sort((a, b) => a - b), s.groups.map((g) => g.id).sort((a, b) => a - b));

  // The salt never leaves the database; totals still rank every team.
  assert.equal(screen.session.anon_salt, undefined);
  const full = await admin("admin_session", { p_session: s.id });
  const expected = Object.fromEntries(s.groups.map((g) => [g.id, 0]));
  for (const b of full.bids) if (full.rounds.find((r) => r.id === b.round_id).phase !== "practice") expected[b.group_id] += b.profit;
  for (const t of screen.totals) assert.ok(Math.abs(t.profit - expected[t.group_id]) < 0.01);
  assert.equal(screen.totals.length, 10);
});

// ---------------------------------------------------------------- Part 3 data

test("Part 3 data opens only after a Part 2 round, with every offer and no names", async () => {
  const s = await newSession(4);
  for (const g of s.groups) await rpc("group_state", { p_code: g.code });
  const play = async (round, priceOf) => {
    await act(s.id, { action: "openRound", roundId: round.id });
    for (const [i, g] of s.groups.entries()) await rpc("group_bid", { p_code: g.code, p_round: round.id, p_price: priceOf(i) });
    await act(s.id, { action: "closeRound", roundId: round.id });
  };
  await play(s.rounds[0], () => 50); // practice
  await play(s.rounds[1], (i) => 40 + i);
  assert.deepEqual(await rpc("analysis_state", { p_session: s.id }), { available: false });

  await play(s.rounds.find((r) => r.phase === "collusion"), () => 200);
  const data = await rpc("analysis_state", { p_session: s.id });
  assert.equal(data.available, true);
  assert.deepEqual(data.rounds.map((r) => r.phase), ["competition", "collusion"]); // practice left out
  assert.equal(data.offers.length, 8);
  assert.deepEqual(Object.keys(data.offers[0]).sort(), ["price", "profit", "round", "slot"]);
  await assert.rejects(rpc("analysis_state", { p_session: "nope" }), /Session not found/);
});

// ---------------------------------------------------------------- joining with the projector QR

test("the join QR creates one team per group; the same phone keeps its team", async () => {
  const { id } = await admin("admin_create_session", { p_name: "QR", p_price_cap: 200, p_round_seconds: 45 });
  let st = await admin("admin_session", { p_session: id });
  assert.equal(st.groups.length, 0); // a new session starts without teams
  assert.equal(st.session.round_seconds, 45);
  assert.equal(st.rounds.length, 15);

  const a = await rpc("join_session", { p_session: id });
  const b = await rpc("join_session", { p_session: id });
  assert.ok(a.new && b.new && a.code !== b.code);
  assert.deepEqual(await rpc("join_session", { p_session: id, p_code: a.code.toLowerCase() }), { code: a.code, new: false });

  st = await admin("admin_session", { p_session: id });
  assert.deepEqual(st.groups.map((g) => [g.slot, g.technology]), [[1, "Nuclear"], [2, "Combined-cycle gas"]]);
  assert.ok(st.groups.every((g) => g.joined_at)); // both count towards demand

  // A code from another session does not get you into this one: you get a new team.
  const other = await newSession(1);
  const c = await rpc("join_session", { p_session: id, p_code: other.groups[0].code });
  assert.ok(c.new && c.code !== other.groups[0].code);
  await assert.rejects(rpc("join_session", { p_session: "nope" }), /Session not found/);
});

test("deleting a session removes all its data and nothing else; log out ends the login", async () => {
  const keep = await newSession(2);
  const gone = await newSession(3);
  const round = gone.rounds[0].id;
  await act(gone.id, { action: "openRound", roundId: round });
  await rpc("group_bid", { p_code: gone.groups[0].code, p_round: round, p_price: 50 });
  await act(gone.id, { action: "closeRound", roundId: round });

  await assert.rejects(rpc("admin_delete_session", { p_token: "made-up", p_session: gone.id }), /Instructor login required/);
  await admin("admin_delete_session", { p_session: gone.id });
  await assert.rejects(admin("admin_session", { p_session: gone.id }), /Session not found/);
  await assert.rejects(rpc("group_state", { p_code: gone.groups[0].code }));
  for (const t of ["groups", "rounds", "bid_log"]) {
    const { rows } = await db.query(`select count(*)::int as n from ${t} where session_id = $1`, [gone.id]);
    assert.equal(rows[0].n, 0, t);
  }
  const { rows } = await db.query("select count(*)::int as n from bids where round_id = $1", [round]);
  assert.equal(rows[0].n, 0);
  assert.equal((await admin("admin_session", { p_session: keep.id })).groups.length, 2);
  await assert.rejects(admin("admin_delete_session", { p_session: gone.id }), /Session not found/);

  const { token: other } = await rpc("admin_login", { p_password: "secret-pw" });
  await rpc("admin_logout", { p_token: other });
  await assert.rejects(rpc("admin_sessions", { p_token: other }), /Instructor login required/);
  await admin("admin_sessions"); // the other login still works
});
