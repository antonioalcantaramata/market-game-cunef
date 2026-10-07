// Creates demo sessions with plausible play, to look at every screen without
// students. Talks to the database API exactly like the web app does.
//
//   node scripts/seed-demo.mjs                       # local (npm run dev must be running)
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=sb_publishable_… \
//   ADMIN_PASSWORD=… node scripts/seed-demo.mjs      # a real Supabase project
//
// It creates two sessions:
//   "Demo · full game"     practice, Part 1 (7 rounds), Part 2 (7 rounds) all played
//   "Demo · after Part 1"  practice and Part 1 played; Part 2 still to come

const URL = process.env.SUPABASE_URL || "http://localhost:54321";
const KEY = process.env.SUPABASE_ANON_KEY || "local-dev";
const PASSWORD = process.env.ADMIN_PASSWORD || "admin";

async function rpc(fn, args) {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: KEY,
      ...(KEY.startsWith("eyJ") ? { Authorization: `Bearer ${KEY}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${fn}: ${data?.message ?? res.status}`);
  return data;
}

// Deterministic randomness, so the demo looks the same every time.
let seed = 20261024;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const between = (a, b) => Math.round(a + rnd() * (b - a));

const NAMES = ["Los Rayos", "Watt's Up", "Green Volt", "Megawatt Masters", "Solar Squad", "Voltaje", "Las Turbinas", "Enchufados", "Chispas", "Power Nap"];

// How each team plays Part 1: where it starts and where it ends after
// learning, round by round, that cheaper offers get bought.
const STYLE = [
  { start: 70, end: 35 }, // undercutter from the start
  { start: 120, end: 50 },
  { start: 95, end: 45 },
  { start: 180, end: 60 }, // greedy, learns the hard way
  { start: 110, end: 48 },
  { start: 150, end: 55 },
  { start: 85, end: 40 },
  { start: 135, end: 52 },
  { start: 160, end: 58 },
  { start: 100, end: 42 },
];

// Part 2: everyone agrees on the cap. The deal holds for three hours, then
// erodes: one team undercuts, then two, then three, a little lower each time.
const CARTEL = [
  () => 200,
  () => 200,
  () => 200,
  (i) => (i === 0 ? 199 : 200),
  (i) => (i === 0 ? 195 : i === 6 ? 199 : 200),
  (i) => (i === 0 ? 190 : i === 6 ? 195 : i === 3 ? 198 : 200),
  (i) => (i === 0 ? 185 : i === 6 ? 190 : i === 3 ? 195 : 200),
];

async function seedSession(token, name, { part2 }) {
  const { id } = await rpc("admin_create_session", {
    p_token: token,
    p_name: name,
    p_groups: 12, // two cards nobody used
    p_price_cap: 200,
    p_round_seconds: 0,
  });
  const act = (action) => rpc("admin_action", { p_token: token, p_session: id, p_action: action });
  const s = await rpc("admin_session", { p_token: token, p_session: id });
  const teams = s.groups.slice(0, 10);
  for (const [i, g] of teams.entries()) {
    await rpc("group_state", { p_code: g.code }); // the team opens its page
    await rpc("group_rename", { p_code: g.code, p_name: NAMES[i] });
  }

  // Forecast ranges (±10%) in every round after the first Part 1 hour.
  const [practice, ...rest] = s.rounds;
  for (const r of rest.slice(1)) await act({ action: "updateRound", roundId: r.id, demandSpread: 0.1 });

  const play = async (round, priceOf) => {
    await act({ action: "openRound", roundId: round.id });
    for (const [i, g] of teams.entries()) {
      const price = Math.max(1, Math.min(200, priceOf(i)));
      // Some teams change their mind once before the round closes.
      if (rnd() < 0.3) await rpc("group_bid", { p_code: g.code, p_round: round.id, p_price: Math.min(200, price + between(5, 25)) });
      await rpc("group_bid", { p_code: g.code, p_round: round.id, p_price: price });
    }
    await act({ action: "closeRound", roundId: round.id });
  };

  await play(practice, () => between(40, 190));
  const part1 = rest.filter((r) => r.phase === "competition");
  for (const [k, r] of part1.entries()) {
    const f = part1.length > 1 ? k / (part1.length - 1) : 0;
    await play(r, (i) => Math.round(STYLE[i].start + (STYLE[i].end - STYLE[i].start) * f) + between(-8, 8));
  }
  if (part2) {
    const part2Rounds = rest.filter((r) => r.phase === "collusion");
    for (const [k, r] of part2Rounds.entries()) await play(r, CARTEL[k] ?? (() => 200));
  }
  return { id, code: teams[0].code };
}

const { token } = await rpc("admin_login", { p_password: PASSWORD });
const full = await seedSession(token, "Demo · full game", { part2: true });
const half = await seedSession(token, "Demo · after Part 1", { part2: false });

console.log(`
Demo data created.

  Demo · full game      panel:     /admin/session/?id=${full.id}
                        projector: /screen/?id=${full.id}   (press S for the summary)
                        a team:    /g/?code=${full.code}

  Demo · after Part 1   panel:     /admin/session/?id=${half.id}
                        projector: /screen/?id=${half.id}   (press S for the summary)
                        a team:    /g/?code=${half.code}
`);
