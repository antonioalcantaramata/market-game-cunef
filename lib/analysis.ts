// Part 3 (Elena): detecting collusion as a change point in the offers.
//
// A faithful port of collusion_test.R, so the projector shows the same numbers
// as the R script on the same data:
//   - the round × team panel of offers and profits (practice excluded, teams
//     that missed a round dropped);
//   - e.divisive() from the R package ecp 3.1.6 (energy distance + permutation
//     test), including its exact floating-point summation order;
//   - the "by hand" permutation test on the biggest jump in the average offer;
//   - the same random numbers as R with set.seed(123) (lib/rrandom.ts).
// scripts/analysis.test.mjs checks the results against the R script's output.

import type { Phase } from "./game";
import { RRandom } from "./rrandom.ts";

// ---------------------------------------------------------------- panel

export interface PanelInput {
  rounds: { number: number; label: string; phase: Phase }[]; // closed rounds
  offers: { round: number; slot: number; price: number; profit: number }[]; // offers actually sent
}

export interface Panel {
  rounds: { number: number; label: string; phase: Phase }[];
  teams: number[]; // team slots kept (present in every round)
  bid: number[][]; // [round][team]
  profit: number[][];
  trueBreakRound: number | null; // first round of Part 2
}

/** Same cleaning as the R script: drop practice, keep teams that bid in every round. */
export function buildPanel(input: PanelInput): Panel {
  const rounds = input.rounds.filter((r) => r.phase !== "practice").sort((a, b) => a.number - b.number);
  const slots = [...new Set(input.offers.map((o) => o.slot))].sort((a, b) => a - b);
  const cell = new Map(input.offers.map((o) => [`${o.round}:${o.slot}`, o]));
  const teams = slots.filter((s) => rounds.every((r) => cell.has(`${r.number}:${s}`)));
  const collusion = rounds.filter((r) => r.phase === "collusion").map((r) => r.number);
  return {
    rounds,
    teams,
    bid: rounds.map((r) => teams.map((s) => cell.get(`${r.number}:${s}`)!.price)),
    profit: rounds.map((r) => teams.map((s) => cell.get(`${r.number}:${s}`)!.profit)),
    trueBreakRound: collusion.length ? Math.min(...collusion) : null,
  };
}

// ---------------------------------------------------------------- e.divisive (ecp)

/** as.matrix(dist(X)) ^ alpha: Euclidean distances, summed column by column like R. */
function distanceMatrix(X: number[][], alpha: number): number[][] {
  const n = X.length;
  const D = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      let s = 0;
      for (let c = 0; c < X[i].length; c++) {
        const dev = X[i][c] - X[j][c];
        s += dev * dev;
      }
      const d = alpha === 1 ? Math.sqrt(s) : Math.sqrt(s) ** alpha;
      D[i][j] = d;
      D[j][i] = d;
    }
  return D;
}

/**
 * splitPointC from ecp's energyChangePoint.cpp, operation for operation.
 * D is the block for observations start..end (1-based, inclusive). Returns
 * [first index of the right segment, statistic].
 */
function splitPointC(s: number, end: number, D: number[][], minSize: number): [number, number] {
  let best: [number, number] = [-1, -Infinity];
  const e = end - s + 1;
  // Rcpp sums matrix blocks column by column.
  const block = (r0: number, r1: number, c0: number, c1: number) => {
    let acc = 0;
    for (let j = c0; j <= c1; j++) for (let i = r0; i <= r1; i++) acc += D[i][j];
    return acc;
  };
  const row = (r: number, c0: number, c1: number) => {
    let acc = 0;
    for (let j = c0; j <= c1; j++) acc += D[r][j];
    return acc;
  };

  let t1 = minSize;
  let t2 = minSize * 2;
  let A = block(0, t1 - 1, 0, t1 - 1) / 2;
  const B1 = block(t1, t2 - 1, t1, t2 - 1) / 2;
  const AB1 = block(0, t1 - 1, t1, t2 - 1);
  let tmp = (2 * AB1) / ((t2 - t1) * t1) - (2 * B1) / ((t2 - t1 - 1) * (t2 - t1)) - (2 * A) / ((t1 - 1) * t1);
  tmp *= (t1 * (t2 - t1)) / t2;
  if (tmp > best[1]) best = [t1 + s, tmp];

  t2 += 1;
  const B = new Array<number>(e + 1).fill(B1);
  const AB = new Array<number>(e + 1).fill(AB1);
  for (; t2 <= e; ++t2) {
    B[t2] = B[t2 - 1] + row(t2 - 1, t1, t2 - 2);
    AB[t2] = AB[t2 - 1] + row(t2 - 1, 0, t1 - 1);
    tmp = (2 * AB[t2]) / ((t2 - t1) * t1) - (2 * B[t2]) / ((t2 - t1 - 1) * (t2 - t1)) - (2 * A) / (t1 * (t1 - 1));
    tmp *= (t1 * (t2 - t1)) / t2;
    if (tmp > best[1]) best = [t1 + s, tmp];
  }

  t1 += 1;
  for (; ; ++t1) {
    t2 = t1 + minSize;
    if (t2 > e) break;
    const addA = row(t1 - 1, 0, t1 - 2);
    A += addA;
    let addB = row(t1 - 1, t1, t2 - 2);
    for (; t2 <= e; ++t2) {
      addB += D[t1 - 1][t2 - 1];
      B[t2] -= addB;
      AB[t2] += addB - addA;
      tmp = (2 * AB[t2]) / ((t2 - t1) * t1) - (2 * B[t2]) / ((t2 - t1 - 1) * (t2 - t1)) - (2 * A) / ((t1 - 1) * t1);
      tmp *= (t1 * (t2 - t1)) / t2;
      if (tmp > best[1]) best = [t1 + s, tmp];
    }
  }
  return best;
}

function splitPoint(start: number, end: number, D: number[][], minSize: number): [number, number] {
  if (end - start + 1 < 2 * minSize) return [-1, -Infinity];
  const sub = D.slice(start - 1, end).map((r) => r.slice(start - 1, end));
  return splitPointC(start, end, sub, minSize);
}

/** e.split: the best new change point over all current segments. */
function eSplit(changes: number[], D: number[][], minSize: number) {
  const splits = [...changes].sort((a, b) => a - b);
  let best: [number, number] = [-1, -Infinity];
  for (let i = 1; i < splits.length; i++) {
    const tmp = splitPoint(splits[i - 1], splits[i] - 1, D, minSize);
    if (tmp[1] > best[1]) best = tmp;
  }
  return { changes: [...changes, best[0]], stat: best[1] };
}

/** perm.cluster: shuffle the observations inside each segment. */
function permCluster(D: number[][], points: number[], rng: RRandom) {
  const sorted = [...points].sort((a, b) => a - b);
  const out = D.map((r) => r.slice());
  for (let k = 0; k + 1 < sorted.length; k++) {
    const idx: number[] = [];
    for (let v = sorted[k]; v < sorted[k + 1]; v++) idx.push(v);
    const u = rng.sample(idx);
    for (let a = 0; a < idx.length; a++)
      for (let b = 0; b < idx.length; b++) out[idx[a] - 1][idx[b] - 1] = D[u[a] - 1][u[b] - 1];
  }
  return out;
}

export interface EDivisiveResult {
  estimates: number[]; // 1-based, including 1 and n + 1 (as in ecp)
  changePoints: number[]; // row indices (1-based) where a new segment starts
  pValues: number[];
  consideredLast: number; // last candidate tested, kept or not (ecp's considered.last; -1 if none)
}

/** ecp::e.divisive(X, sig.lvl, R, min.size, alpha). */
export function eDivisive(
  X: number[][],
  { sigLvl = 0.05, R = 199, minSize = 30, alpha = 1 }: { sigLvl?: number; R?: number; minSize?: number; alpha?: number },
  rng: RRandom,
): EDivisiveResult {
  const n = X.length;
  const D = distanceMatrix(X, alpha);
  let changes = [1, n + 1];
  const pValues: number[] = [];
  let consideredLast = -1;
  for (let k = n; k > 0; k--) {
    const split = eSplit(changes, D, minSize);
    consideredLast = split.changes[split.changes.length - 1];
    if (consideredLast === -1) break;
    // sig.test: how often does shuffling within the segments release as much energy?
    let over = 0;
    for (let f = 0; f < R; f++) if (eSplit(changes, permCluster(D, changes, rng), minSize).stat >= split.stat) over++;
    const p = (1 + over) / (R + 1);
    pValues.push(p);
    if (p > sigLvl) break;
    changes = split.changes;
  }
  const estimates = [...changes].sort((a, b) => a - b);
  return { estimates, changePoints: estimates.slice(1, -1), pValues, consideredLast };
}

/** How different the rounds before and after each split are (first scan of e.divisive, for the chart). */
export function energyProfile(X: number[][], minSize: number, alpha = 1) {
  const D = distanceMatrix(X, alpha);
  const n = X.length;
  const out: { index: number; stat: number }[] = [];
  for (let tau = minSize + 1; tau <= n - minSize + 1; tau++) {
    // Best statistic with the change at row tau, over every end of the right segment.
    let best = -Infinity;
    for (let kappa = tau + minSize; kappa <= n + 1; kappa++) {
      const m = tau - 1;
      const k = kappa - tau;
      let A = 0, B = 0, AB = 0;
      for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) A += D[i][j];
      for (let i = tau - 1; i < kappa - 1; i++) for (let j = i + 1; j < kappa - 1; j++) B += D[i][j];
      for (let i = 0; i < m; i++) for (let j = tau - 1; j < kappa - 1; j++) AB += D[i][j];
      const q = ((2 * AB) / (m * k) - (2 * B) / (k * (k - 1)) - (2 * A) / (m * (m - 1))) * ((m * k) / (m + k));
      if (q > best) best = q;
    }
    out.push({ index: tau, stat: best });
  }
  return out;
}

// ---------------------------------------------------------------- the "by hand" permutation test

/** mean() as R computes it for doubles (two passes). */
function rMean(x: number[]) {
  let s = 0;
  for (const v of x) s += v;
  s /= x.length;
  if (Number.isFinite(s)) {
    let t = 0;
    for (const v of x) t += v - s;
    s += t / x.length;
  }
  return s;
}

/** split_stat: the biggest gap in average offer between the rounds before and after a split. */
export function splitStat(x: number[]) {
  let best = 0;
  let at = 0;
  for (let k = 1; k < x.length; k++) {
    const d = Math.abs(rMean(x.slice(0, k)) - rMean(x.slice(k)));
    if (d > best) {
      best = d;
      at = k;
    }
  }
  return { value: best, at };
}

/** rowMeans() for a full matrix: sum across columns, then divide. */
export function rowMeans(X: number[][]) {
  return X.map((r) => {
    let s = 0;
    for (const v of r) s += v;
    return s / r.length;
  });
}

// ---------------------------------------------------------------- the whole script

export interface Analysis {
  panel: Panel;
  offers: EDivisiveResult; // change point on the offers
  profits: EDivisiveResult; // the same test on profits
  changeRound: number | null; // first round after the detected change (5% level, as in the R script)
  profitChangeRound: number | null;
  // When nothing passes the 5% level, the change tested anyway and its p-value,
  // so the screens can report it if it is significant at the 10% level.
  offersCandidate: { round: number; p: number } | null;
  profitsCandidate: { round: number; p: number } | null;
  energy: { round: number; stat: number }[]; // first scan on the offers, for the chart
  profitEnergy: { round: number; stat: number }[]; // the same scan on the profits
  meanOffer: number[]; // average offer per round, in time order
  observed: { value: number; at: number }; // real biggest jump and where
  shuffles: { order: number[]; value: number; at: number }[]; // each shuffled world
  permutationP: number;
}

export const ANALYSIS_SETTINGS = { seed: 123, R: 999, sigLvl: 0.05, minSize: 2, alpha: 1, B: 200 } as const;

/** Runs collusion_test.R's analysis, in the same order and with the same random numbers. */
export function runAnalysis(panel: Panel): Analysis {
  const { seed, R, sigLvl, minSize, alpha, B } = ANALYSIS_SETTINGS;
  const roundAt = (i: number | undefined) => (i == null ? null : panel.rounds[i - 1]?.number ?? null);

  const rng = new RRandom(seed); // set.seed(123)
  const offers = eDivisive(panel.bid, { sigLvl, R, minSize, alpha }, rng);
  const profits = eDivisive(panel.profit, { sigLvl, R, minSize, alpha }, rng); // continues the same stream

  const meanOffer = rowMeans(panel.bid);
  const observed = splitStat(meanOffer);
  const rng2 = new RRandom(seed); // set.seed(123) again before replicate()
  const indices = meanOffer.map((_, i) => i);
  const shuffles = Array.from({ length: B }, () => {
    const order = rng2.sample(indices); // same draws as sample(x)
    return { order, ...splitStat(order.map((i) => meanOffer[i])) };
  });
  const beats = shuffles.filter((s) => s.value >= observed.value).length;

  const candidate = (r: EDivisiveResult) =>
    r.changePoints.length === 0 && r.consideredLast > 0 && r.pValues.length
      ? { round: roundAt(r.consideredLast)!, p: r.pValues[0] }
      : null;

  return {
    panel,
    offers,
    profits,
    offersCandidate: candidate(offers),
    profitsCandidate: candidate(profits),
    changeRound: roundAt(offers.changePoints[0]),
    profitChangeRound: roundAt(profits.changePoints[0]),
    energy: energyProfile(panel.bid, minSize, alpha).map((e) => ({ round: panel.rounds[e.index - 1].number, stat: e.stat })),
    profitEnergy: energyProfile(panel.profit, minSize, alpha).map((e) => ({ round: panel.rounds[e.index - 1].number, stat: e.stat })),
    meanOffer,
    observed,
    shuffles,
    permutationP: (1 + beats) / (B + 1),
  };
}
