// Part 3: the app's analysis must give exactly the results of Elena's R script
// (collusion_test.R with R 4.1.3, ecp 3.1.6 and set.seed(123)) on the same data.
// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { RRandom } from "../lib/rrandom.ts";
import { buildPanel, runAnalysis } from "../lib/analysis.ts";

const read = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), "utf8"));
const demo4x4 = read("./fixtures/demo-4x4.json");
const backup = { input: read("../lib/backup-game.json"), r: read("./fixtures/backup-game-r.json").r };

test("random numbers are identical to R's set.seed / runif / sample", () => {
  const R = demo4x4.r;
  let rng = new RRandom(123);
  assert.deepEqual([rng.unif(), rng.unif(), rng.unif()], R.rng.seed123_runif3);
  assert.deepEqual(rng.sample([1, 2, 3, 4, 5, 6, 7, 8]), R.rng.seed123_then_sample8);
  rng = new RRandom(42);
  assert.deepEqual(rng.sample(Array.from({ length: 100 }, (_, i) => i + 1)).slice(0, 10), R.rng.seed42_sample100_first10);
});

function sameAsR(input, R) {
  const a = runAnalysis(buildPanel(input));
  assert.deepEqual(a.offers.estimates, R.offers.estimates);
  assert.deepEqual(a.offers.pValues, R.offers.pValues);
  assert.equal(a.changeRound, R.offers.changeRound);
  assert.equal(a.offers.consideredLast, R.offers.consideredLast);
  assert.deepEqual(a.profits.estimates, R.profits.estimates);
  assert.deepEqual(a.profits.pValues, R.profits.pValues);
  assert.equal(a.profitChangeRound, R.profits.changeRound);
  assert.equal(a.profits.consideredLast, R.profits.consideredLast);

  assert.equal(a.observed.value, R.permutation.tObs);
  assert.equal(a.shuffles.filter((s) => s.value >= a.observed.value).length, R.permutation.beats);
  assert.equal(a.permutationP, R.permutation.p);
  assert.deepEqual(a.shuffles.slice(0, 6).map((s) => +s.value.toPrecision(12)), R.permutation.head);
  assert.equal(+a.shuffles.reduce((t, s) => t + s.value, 0).toPrecision(12), R.permutation.sum);

  // The bars of each scan peak where the change is.
  const peak = (e) => e.reduce((m, x) => (x.stat > m.stat ? x : m)).round;
  assert.equal(peak(a.energy), a.changeRound);
  assert.equal(peak(a.profitEnergy), a.profitChangeRound ?? a.profitsCandidate.round);
  return a;
}

test("the backup example game (7 + 7 rounds) gives exactly R's results", () => {
  const panel = buildPanel(backup.input);
  assert.equal(panel.rounds.length, 14); // practice left out
  assert.equal(panel.teams.length, 10); // teams 11–12 never played
  assert.equal(panel.trueBreakRound, 9);
  const a = sameAsR(backup.input, backup.r);
  assert.equal(a.offersCandidate, null); // both significant at 5%: nothing to report at 10%
  assert.equal(a.profitsCandidate, null);
});

test("the earlier 4 + 4 game gives exactly R's results, profits only at 10%", () => {
  const R = demo4x4.r;
  const a = sameAsR(demo4x4.input, R);
  assert.equal(a.panel.rounds.length, 8);
  assert.equal(a.offersCandidate, null);
  assert.deepEqual(a.profitsCandidate, { round: R.profits.consideredRound, p: R.profits.pValues[0] });
});

test("the analysis never breaks on unusual games (few rounds, ties, flat prices, one team)", () => {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cases = [];
  for (let c = 0; c < 40; c++) {
    const nP1 = 2 + Math.floor(rnd() * 4);
    const nP2 = 2 + Math.floor(rnd() * 4);
    const teams = 1 + Math.floor(rnd() * 11);
    const style = c % 4; // 0 random, 1 flat, 2 heavy ties, 3 cartel
    const rounds = [];
    const offers = [];
    for (let i = 0; i < nP1 + nP2; i++) {
      const phase = i < nP1 ? "competition" : "collusion";
      rounds.push({ number: i + 2, label: `${i}:00 · Hour`, phase });
      for (let t = 1; t <= teams; t++) {
        const price =
          style === 1 ? 100 : style === 2 ? [50, 100, 200][Math.floor(rnd() * 3)] : style === 3 && phase === "collusion" ? 200 : Math.round(rnd() * 200);
        offers.push({ round: i + 2, slot: t, price, profit: Math.round(price * 100 * rnd()) });
      }
    }
    cases.push({ rounds, offers });
  }
  // One team skipped a round: it is dropped, like in the R script.
  cases.push({ ...cases[0], offers: cases[0].offers.filter((o) => !(o.slot === 1 && o.round === 3)) });

  for (const input of cases) {
    const a = runAnalysis(buildPanel(input));
    assert.ok(a.energy.length > 0 && a.energy.every((e) => Number.isFinite(e.stat)));
    assert.ok(a.offers.pValues.every((p) => p > 0 && p <= 1));
    assert.ok(a.changeRound === null || a.panel.rounds.some((r) => r.number === a.changeRound));
    assert.equal(a.shuffles.length, 200);
    assert.ok(Number.isFinite(a.observed.value) && a.permutationP > 0 && a.permutationP <= 1);
  }
});
