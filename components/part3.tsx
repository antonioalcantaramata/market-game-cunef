"use client";

// Statistical analysis on the projector: Elena's collusion detection, step by step.
// The numbers come from lib/analysis.ts (a faithful port of collusion_test.R);
// this file only turns them into five animated, clicker-driven screens:
//   1. every team's offer, round by round
//   2. the computer scans for the change point (energy distance, ecp::e.divisive)
//   3. the same scan on the profits
//   4. where the p-value comes from: shuffling the rounds
//   5. offer vs profit, round by round
// Keys (also the presentation clicker): → next (or finish the animation), ← back, R replay,
// E switches between this session's data and the bundled example game (a backup
// in case the live results are not usable; it is labelled as simulated on screen).

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { buildPanel, runAnalysis, ANALYSIS_SETTINGS, type Analysis, type PanelInput } from "@/lib/analysis";
import backupGame from "@/lib/backup-game.json";
import type { Phase } from "@/lib/game";
import { C, ticks } from "./charts";
import { eur } from "./client";
import { PHASE_COLOR } from "./ui";

const W = 1520; // content width inside the 1600 × 900 projector stage
const PLANT_MW = 100; // every plant in the game (pay-as-bid, see supabase/schema.sql)

const STEPS = [
  { key: "offers", title: "Every team's offer, round by round" },
  { key: "scan", title: "Can a computer spot the change by itself?" },
  { key: "profits", title: "And the profits? The same test" },
  { key: "shuffle", title: "How sure are we? Shuffle the rounds" },
  { key: "scatter", title: "Offer vs profit, round by round" },
] as const;

const NEXT = new Set(["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"]);
const PREV = new Set(["ArrowLeft", "ArrowUp", "PageUp", "Backspace"]);

const hour = (label: string) => label.split("·").pop()!.trim();
// "07:00 · Early morning" → "07:00", for narrow columns.
const clock = (label: string) => (label.includes("·") ? label.split("·")[0].trim() : label);
const pFmt = (p: number) => (p < 0.001 ? "< 0.001" : p.toFixed(3));
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const ease = (x: number) => 1 - (1 - clamp01(x)) ** 3;

/** Milliseconds since the animation of `run` started, capped at `duration`; `done` jumps to the end. */
function useClock(duration: number, run: number, done: boolean) {
  const [state, setState] = useState({ run, elapsed: 0 });
  useEffect(() => {
    if (done) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      // rAF timestamps can be slightly earlier than performance.now(): never go below 0.
      const elapsed = Math.max(0, now - start);
      setState({ run, elapsed });
      if (elapsed < duration) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration, run, done]);
  if (done) return duration;
  return state.run === run ? Math.max(0, Math.min(state.elapsed, duration)) : 0;
}

// ---------------------------------------------------------------- controller

type Source = "live" | "example";
const SOURCE_KEY = "market-game:analysis-source";
const EXAMPLE_PRICE_CAP = 200;

function loadSource(): Source {
  try {
    return localStorage.getItem(SOURCE_KEY) === "example" ? "example" : "live";
  } catch {
    return "live";
  }
}

export function Part3({ id, priceCap }: { id: string; priceCap: number }) {
  const { data, error } = useSWR(["analysis", id], () => api.analysis(id), { refreshInterval: 5000 });
  const [source, setSource] = useState<Source>(loadSource);
  const example = useMemo(() => runAnalysis(buildPanel(backupGame as PanelInput)), []);
  const live = useMemo(() => {
    if (!data?.available || !data.rounds || !data.offers) return null;
    const panel = buildPanel({ rounds: data.rounds, offers: data.offers });
    if (panel.rounds.length < 2 * ANALYSIS_SETTINGS.minSize || panel.teams.length === 0) return null;
    return runAnalysis(panel);
  }, [data]);

  const [step, setStep] = useState(0);
  const [run, setRun] = useState(0);
  const [done, setDone] = useState(false);

  const chooseSource = (next: Source) => {
    setSource(next);
    try {
      localStorage.setItem(SOURCE_KEY, next);
    } catch {}
    setStep(0);
    setRun((r) => r + 1);
    setDone(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (NEXT.has(e.key)) {
        e.preventDefault();
        if (!done) setDone(true);
        else if (step < STEPS.length - 1) {
          setStep(step + 1);
          setRun((r) => r + 1);
          setDone(false);
        }
      } else if (PREV.has(e.key)) {
        e.preventDefault();
        if (step > 0) {
          setStep(step - 1);
          setRun((r) => r + 1);
          setDone(true); // going back shows the finished screen
        }
      } else if (e.key === "r" || e.key === "R") {
        setRun((r) => r + 1);
        setDone(false);
      } else if (e.key === "e" || e.key === "E") {
        chooseSource(source === "live" ? "example" : "live");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const isExample = source === "example";
  const analysis = isExample ? example : live;
  const switcher = <SourceSwitch source={source} onChange={chooseSource} />;

  if (!isExample) {
    const fallback = "Press E (or use the switch) to show the example game instead.";
    if (error) return <Message title="Could not load the data" text={error.message} hint={fallback} action={switcher} />;
    if (!data) return null;
    if (!data.available)
      return (
        <Message
          title="The analysis unlocks after Part 2"
          text="It needs at least one round of Part 2 to look for the change."
          hint={fallback}
          action={switcher}
        />
      );
    if (!analysis)
      return (
        <Message
          title="Not enough rounds yet"
          text={`The analysis needs at least ${2 * ANALYSIS_SETTINGS.minSize} rounds without the practice round.`}
          hint={fallback}
          action={switcher}
        />
      );
  }
  if (!analysis) return null;

  const props = { a: analysis, priceCap: isExample ? EXAMPLE_PRICE_CAP : priceCap, run, done, onDone: () => setDone(true) };
  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-3xl font-bold">
          <span className="mr-3 text-orange">Statistical analysis</span>
          {STEPS[step].title}
        </h2>
        <div className="flex shrink-0 items-center gap-3">
          {isExample ? (
            <span className="rounded-full bg-orange px-3 py-1 text-sm font-semibold whitespace-nowrap text-white">
              Simulated data · not today&apos;s session
            </span>
          ) : (
            <span className="text-base whitespace-nowrap text-ink-3">
              {analysis.panel.teams.length} {analysis.panel.teams.length === 1 ? "team" : "teams"} ·{" "}
              {analysis.panel.rounds.length} rounds
            </span>
          )}
          {switcher}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {step === 0 && <OffersStep {...props} />}
        {step === 1 && <ScanStep {...props} measure="offers" />}
        {step === 2 && <ScanStep {...props} measure="profits" />}
        {step === 3 && <ShuffleStep {...props} />}
        {step === 4 && <ScatterStep {...props} />}
      </div>
      <div className="flex items-center justify-between text-sm text-ink-3">
        <div className="flex gap-2">
          {STEPS.map((s, i) => (
            <span
              key={s.key}
              className={`rounded-full px-3 py-1 font-semibold ${i === step ? "bg-navy text-white" : "bg-white text-ink-3"}`}
            >
              {i + 1}. {["Offers", "Change point", "Profits", "Shuffle test", "Offer vs profit"][i]}
            </span>
          ))}
        </div>
        <span>→ next · ← back · R replay · E example game</span>
      </div>
    </div>
  );
}

function Message({ title, text, hint, action }: { title: string; text: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="card m-auto flex max-w-2xl flex-col items-center gap-2 p-10 text-center">
      <div className="text-3xl font-bold text-navy">{title}</div>
      <p className="text-xl text-ink-2">{text}</p>
      {hint && <p className="mt-3 text-base text-ink-3">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** This session's data or the bundled example game. */
function SourceSwitch({ source, onChange }: { source: Source; onChange: (s: Source) => void }) {
  return (
    <div className="flex rounded-lg bg-white p-1 text-sm shadow-sm" title="E: switch between this game and the example game">
      {(["live", "example"] as Source[]).map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={`rounded-md px-3 py-1 font-semibold ${source === s ? (s === "example" ? "bg-orange text-white" : "bg-navy text-white") : "text-ink-2"}`}
        >
          {s === "live" ? "This game" : "Example game"}
        </button>
      ))}
    </div>
  );
}

type StepProps = { a: Analysis; priceCap: number; run: number; done: boolean; onDone: () => void };

/**
 * The change to report, if any: significant at 5% (what the R script keeps),
 * or, failing that, the change it tested anyway when its p-value is ≤ 10%.
 */
type Finding = { round: number; p: number; level: 5 | 10 };
function finding(round: number | null, p: number | undefined, candidate: { round: number; p: number } | null): Finding | null {
  if (round != null && p != null) return { round, p, level: 5 };
  if (candidate && candidate.p <= 0.1) return { ...candidate, level: 10 };
  return null;
}
const levelText = (f: Finding) =>
  f.level === 5 ? "significant at the 5% level" : "significant at the 10% level, though not at the usual 5%";

// ---------------------------------------------------------------- shared chart frame

function useFrame(a: Analysis, priceCap: number, height: number, width = W, top?: number) {
  const m = { top: 34, right: 30, bottom: 56, left: 70 };
  const n = a.panel.rounds.length;
  const iw = width - m.left - m.right;
  const ih = height - m.top - m.bottom;
  const step = iw / n;
  const yMax = top ?? Math.max(priceCap, ...a.panel.bid.flat()) * 1.06;
  return {
    m,
    iw,
    ih,
    step,
    x: (i: number) => m.left + step * (i + 0.5),
    y: (v: number) => m.top + ih - (v / yMax) * ih,
    yMax,
    // x of the boundary just before round index i
    between: (i: number) => m.left + step * i,
  };
}

function PhaseBands({ a, f }: { a: Analysis; f: ReturnType<typeof useFrame> }) {
  const fill: Record<Phase, string> = { practice: "#f4f3f1", competition: "#eef3fb", collusion: "#fff0e6" };
  const runs: { phase: Phase; from: number; to: number }[] = [];
  a.panel.rounds.forEach((r, i) => {
    const last = runs[runs.length - 1];
    if (last && last.phase === r.phase) last.to = i;
    else runs.push({ phase: r.phase, from: i, to: i });
  });
  return (
    <>
      {runs.map((b) => (
        <g key={b.from}>
          <rect x={f.between(b.from)} y={f.m.top} width={f.step * (b.to - b.from + 1)} height={f.ih} fill={fill[b.phase]} />
          <text x={f.between(b.from) + 10} y={f.m.top + 24} fontSize={17} fontWeight={700} fill={PHASE_COLOR[b.phase]}>
            {b.phase === "collusion" ? "Part 2 · agreements allowed" : "Part 1 · competition"}
          </text>
        </g>
      ))}
    </>
  );
}

function Axes({ a, f, unit = "€/MWh", max }: { a: Analysis; f: ReturnType<typeof useFrame>; unit?: string; max?: number }) {
  return (
    <>
      {ticks(max ?? f.yMax / 1.06, 4).map((t) => (
        <g key={t}>
          <line x1={f.m.left} x2={f.m.left + f.iw} y1={f.y(t)} y2={f.y(t)} stroke={C.grid} />
          <text x={f.m.left - 10} y={f.y(t)} dy="0.32em" textAnchor="end" fontSize={15} fill={C.text} className="tabular">
            €{t.toLocaleString("en-GB")}
          </text>
        </g>
      ))}
      <line x1={f.m.left} x2={f.m.left + f.iw} y1={f.y(0)} y2={f.y(0)} stroke={C.axis} />
      {a.panel.rounds.map((r, i) => (
        <g key={r.number}>
          <text x={f.x(i)} y={f.m.top + f.ih + 22} textAnchor="middle" fontSize={16} fontWeight={600} fill={C.strong}>
            R{r.number}
          </text>
          <text x={f.x(i)} y={f.m.top + f.ih + 42} textAnchor="middle" fontSize={13} fill={C.axis}>
            {f.step >= 95 ? hour(r.label) : clock(r.label)}
          </text>
        </g>
      ))}
      <text x={f.m.left} y={f.m.top - 12} fontSize={15} fill={C.text}>
        {unit}
      </text>
    </>
  );
}

function TeamLines({
  a,
  f,
  opacity = 0.45,
  values = a.panel.bid,
}: {
  a: Analysis;
  f: ReturnType<typeof useFrame>;
  opacity?: number;
  values?: number[][];
}) {
  return (
    <>
      {a.panel.teams.map((_, t) => (
        <g key={t} opacity={opacity}>
          <polyline
            points={values.map((row, i) => `${f.x(i)},${f.y(row[t])}`).join(" ")}
            fill="none"
            stroke={C.sold}
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
          {values.map((row, i) => (
            <circle key={i} cx={f.x(i)} cy={f.y(row[t])} r={4.5} fill={C.sold} />
          ))}
        </g>
      ))}
    </>
  );
}

function BreakLine({ f, index, label, color, y = 0, dash = "8 6" }: { f: ReturnType<typeof useFrame>; index: number; label: string; color: string; y?: number; dash?: string }) {
  const x = f.between(index);
  return (
    <g>
      <line x1={x} x2={x} y1={f.m.top - 6} y2={f.m.top + f.ih} stroke={color} strokeWidth={3} strokeDasharray={dash} />
      <rect x={x + 6} y={f.m.top + 80 + y} width={label.length * 8.6 + 16} height={28} rx={6} fill="#fff" stroke={color} strokeWidth={1.5} />
      <text x={x + 14} y={f.m.top + 99 + y} fontSize={15} fontWeight={700} fill={C.strong}>
        {label}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------- 1. offers

function OffersStep({ a, priceCap, run, done, onDone }: StepProps) {
  const duration = 3200;
  const t = useClock(duration, run, done);
  useEffect(() => {
    if (t >= duration && !done) onDone();
  }, [t, done, onDone]);
  const f = useFrame(a, priceCap, 600);
  const reveal = ease(t / 2600);
  const breakIdx = a.panel.rounds.findIndex((r) => r.number === a.panel.trueBreakRound);
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="card px-4 pt-3">
        <svg width={W - 32} height={600} role="img" aria-label="Every team's offer in every round">
          <PhaseBands a={a} f={f} />
          <Axes a={a} f={f} />
          <clipPath id="reveal">
            <rect x={0} y={0} width={f.m.left + f.iw * reveal + 6} height={600} />
          </clipPath>
          <g clipPath="url(#reveal)">
            <TeamLines a={a} f={f} />
          </g>
          {breakIdx > 0 && t >= 2800 && (
            <g opacity={clamp01((t - 2800) / 400)}>
              <BreakLine f={f} index={breakIdx} label="Agreements allowed from here" color={C.demand} />
            </g>
          )}
        </svg>
      </div>
      <p className="text-center text-2xl text-ink-2">
        One line per team. <b className="text-ink">Something changed. When exactly?</b> Could we tell without knowing the rules?
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- 2. change point scan

function ScanStep({ a, priceCap, run, done, onDone, measure }: StepProps & { measure: "offers" | "profits" }) {
  const offers = measure === "offers";
  const values = offers ? a.panel.bid : a.panel.profit;
  const energy = offers ? a.energy : a.profitEnergy;
  const perCandidate = 700;
  const scanMs = energy.length * perCandidate;
  const duration = scanMs + 1400;
  const t = useClock(duration, run, done);
  useEffect(() => {
    if (t >= duration && !done) onDone();
  }, [t, duration, done, onDone]);

  const profitTop = Math.max(1000, Math.ceil((Math.max(...a.panel.profit.flat(), 0) * 1.08) / 2000) * 2000);
  const f = useFrame(a, priceCap, 360, 960, offers ? undefined : profitTop);
  const shown = Math.min(energy.length, t / perCandidate); // candidates scanned so far (fractional)
  const current = Math.max(0, Math.min(energy.length - 1, Math.floor(shown)));
  const scanning = t < scanMs;
  const maxStat = Math.max(...energy.map((e) => e.stat));
  const bestIdx = energy.findIndex((e) => e.stat === maxStat);
  const indexOf = (round: number | null) => a.panel.rounds.findIndex((r) => r.number === round);
  const cursorRound = energy[current].round;
  const verdict = t >= scanMs;
  const trueIdx = indexOf(a.panel.trueBreakRound);
  const offersFind = finding(a.changeRound, a.offers.pValues[0], a.offersCandidate);
  const profitsFind = finding(a.profitChangeRound, a.profits.pValues[0], a.profitsCandidate);
  const main = offers ? offersFind : profitsFind;
  const other = offers ? profitsFind : offersFind;
  const mainP = (offers ? a.offers : a.profits).pValues[0] ?? 1;
  const otherP = (offers ? a.profits : a.offers).pValues[0] ?? 1;
  const detIdx = indexOf(main?.round ?? null);
  const match = main != null && main.round === a.panel.trueBreakRound;
  const prevRound = (round: number) => a.panel.rounds[indexOf(round) - 1]?.number;
  const what = offers ? "offers" : "profits";

  // bar chart of the scan
  const bm = { top: 36, right: 20, bottom: 50, left: 70 };
  const bw = 960;
  const bh = 260;
  const biw = bw - bm.left - bm.right;
  const bih = bh - bm.top - bm.bottom;
  const slot = biw / energy.length;

  return (
    <div className="grid h-full grid-cols-[960px_1fr] gap-5">
      <div className="flex flex-col gap-3">
        <div className="card px-3 pt-3">
          <svg width={936} height={360} role="img" aria-label={`Each team's ${what} with the split being tested`}>
            <PhaseBands a={a} f={f} />
            <Axes a={a} f={f} unit={offers ? "Offer, €/MWh" : "Profit per team, €"} max={offers ? undefined : profitTop} />
            <TeamLines a={a} f={f} opacity={offers ? 0.3 : 0.45} values={values} />
            {scanning && (
              <g>
                <rect x={f.m.left} y={f.m.top} width={f.between(indexOf(cursorRound)) - f.m.left} height={f.ih} fill={C.sold} opacity={0.06} />
                <line x1={f.between(indexOf(cursorRound))} x2={f.between(indexOf(cursorRound))} y1={f.m.top} y2={f.m.top + f.ih} stroke={C.strong} strokeWidth={3} />
                <text x={f.between(indexOf(cursorRound)) - 8} y={f.m.top + f.ih - 10} textAnchor="end" fontSize={15} fontWeight={700} fill={C.strong}>before</text>
                <text x={f.between(indexOf(cursorRound)) + 8} y={f.m.top + f.ih - 10} fontSize={15} fontWeight={700} fill={C.strong}>after</text>
              </g>
            )}
            {verdict && detIdx > 0 && (
              <BreakLine f={f} index={detIdx} label={main?.level === 10 ? "Change detected (10% level)" : "Change detected"} color={C.strong} dash="0" />
            )}
            {verdict && trueIdx > 0 && !match && <BreakLine f={f} index={trueIdx} label="Agreements allowed" color={C.demand} y={36} />}
          </svg>
        </div>
        <div className="card px-3 pt-2">
          <svg width={936} height={bh} role="img" aria-label={`How different the ${what} before and after each split are`}>
            <text x={bm.left} y={14} fontSize={15} fill={C.text}>
              How different are the {what} “before” and “after”? (energy distance)
            </text>
            <line x1={bm.left} x2={bm.left + biw} y1={bm.top + bih} y2={bm.top + bih} stroke={C.axis} />
            {energy.map((e, i) => {
              const grow = clamp01(shown - i);
              const h = maxStat > 0 ? (Math.max(0, e.stat) / maxStat) * (bih - 20) * ease(grow) : 0;
              const isBest = verdict && maxStat > 0 && i === bestIdx;
              return (
                <g key={e.round}>
                  <rect
                    x={bm.left + slot * i + slot * 0.2}
                    y={bm.top + bih - h}
                    width={slot * 0.6}
                    height={h}
                    rx={4}
                    fill={isBest ? C.demand : C.sold}
                    opacity={grow > 0 ? 1 : 0}
                  />
                  <text x={bm.left + slot * (i + 0.5)} y={bm.top + bih + 22} textAnchor="middle" fontSize={15} fill={C.strong}>
                    R{prevRound(e.round)} | R{e.round}
                  </text>
                  {isBest && (
                    <text x={bm.left + slot * (i + 0.5)} y={bm.top + bih - h - 8} textAnchor="middle" fontSize={15} fontWeight={700} fill={C.strong}>
                      biggest
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="card p-6 text-xl leading-relaxed text-ink-2">
          {offers ? (
            <>
              The computer tries <b className="text-ink">every place to cut</b> the game in two. For each cut it measures how
              different all the offers before and after are, team by team (the <b className="text-ink">energy distance</b>). It
              then keeps the biggest one.
            </>
          ) : (
            <>
              Same test, now on <b className="text-ink">what each team earned</b>. Profits depend on the price asked, but also on
              whether the offer was bought and on demand, which changes every hour: the lines are much noisier.
            </>
          )}
        </div>
        {verdict ? (
          <div className={`rounded-2xl p-6 text-white ${main ? "bg-navy" : "bg-ink-2"}`}>
            {main ? (
              <>
                <div className="text-xl opacity-80">{main.level === 5 ? "Change detected" : "Change detected, weaker evidence"}</div>
                <div className="text-4xl font-bold">
                  between R{prevRound(main.round)} and R{main.round}
                </div>
                <div className="mt-1 text-xl">
                  p = {pFmt(main.p)} · {levelText(main)}
                </div>
                <div className="text-base opacity-70">{ANALYSIS_SETTINGS.R} shuffles</div>
                {match && <div className="mt-3 text-2xl font-bold text-orange">✓ Exactly when agreements were allowed</div>}
              </>
            ) : (
              <>
                <div className="text-xl opacity-80">No significant change</div>
                <div className="text-3xl font-bold">p = {pFmt(mainP)}</div>
              </>
            )}
          </div>
        ) : (
          <div className="card flex flex-1 items-center justify-center p-6 text-2xl text-ink-3">Scanning…</div>
        )}
        {verdict && (
          <div className="card p-5 text-lg text-ink-2">
            <b className="text-ink">{offers ? "Same test on profits:" : "Compare with the offers:"}</b>{" "}
            {other ? (
              <>
                change between R{prevRound(other.round)} and R{other.round}
                {main && other.round === main.round ? " too" : ""} (p = {pFmt(other.p)}), <b className="text-ink">{levelText(other)}</b>.
                {offers && " Next screen."}
              </>
            ) : (
              `no significant change (p = ${pFmt(otherP)}).`
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 3. shuffle test

function MiniBars({
  a,
  order,
  at,
  label,
  value,
  width,
  priceCap,
  animate,
}: {
  a: Analysis;
  order: number[];
  at: number;
  label: string;
  value: number;
  width: number;
  priceCap: number;
  animate: boolean;
}) {
  const h = 250;
  const m = { top: 46, right: 16, bottom: 30, left: 16 };
  const iw = width - m.left - m.right;
  const ih = h - m.top - m.bottom;
  const slot = iw / order.length;
  const y = (v: number) => m.top + ih - (v / (priceCap * 1.05)) * ih;
  const xs = order.map((v) => a.meanOffer[v]);
  const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const left = at > 0 ? mean(xs.slice(0, at)) : 0;
  const right = at > 0 ? mean(xs.slice(at)) : 0;
  return (
    <svg width={width} height={h}>
      <text x={m.left} y={20} fontSize={17} fontWeight={700} fill={C.strong}>{label}</text>
      <text x={width - m.right} y={20} textAnchor="end" fontSize={17} fill={C.text}>
        biggest jump <tspan fontWeight={700} fill={C.strong}>{eur(value, 1)}</tspan>
      </text>
      <line x1={m.left} x2={m.left + iw} y1={y(0)} y2={y(0)} stroke={C.axis} />
      {a.meanOffer.map((v, roundIdx) => {
        const pos = order.indexOf(roundIdx);
        return (
          <g
            key={roundIdx}
            style={{ transform: `translateX(${m.left + slot * pos}px)`, transition: animate ? "transform 700ms cubic-bezier(.2,.8,.2,1)" : "none" }}
          >
            <rect x={slot * 0.15} y={y(v)} width={slot * 0.7} height={y(0) - y(v)} rx={4} fill={PHASE_COLOR[a.panel.rounds[roundIdx].phase]} />
            <text x={slot / 2} y={h - 8} textAnchor="middle" fontSize={13} fill={C.text}>R{a.panel.rounds[roundIdx].number}</text>
          </g>
        );
      })}
      {/* at = 0 means every split gives the same average: no jump to draw */}
      {at > 0 && (
        <>
          <line x1={m.left} x2={m.left + slot * at} y1={y(left)} y2={y(left)} stroke={C.strong} strokeWidth={3} strokeDasharray="6 4" />
          <line x1={m.left + slot * at} x2={m.left + iw} y1={y(right)} y2={y(right)} stroke={C.strong} strokeWidth={3} strokeDasharray="6 4" />
          <line x1={m.left + slot * at} x2={m.left + slot * at} y1={Math.min(y(left), y(right))} y2={Math.max(y(left), y(right))} stroke={C.strong} strokeWidth={2} />
        </>
      )}
    </svg>
  );
}

function ShuffleStep({ a, priceCap, run, done, onDone }: StepProps) {
  const B = a.shuffles.length;
  const intro = 1800; // the real order alone
  const slowN = Math.min(5, B);
  const slowMs = 1500;
  const fastMs = 40;
  const outro = 1200;
  const duration = intro + slowN * slowMs + (B - slowN) * fastMs + outro;
  const t = useClock(duration, run, done);
  useEffect(() => {
    if (t >= duration && !done) onDone();
  }, [t, duration, done, onDone]);

  const afterIntro = t - intro;
  const count =
    afterIntro <= 0
      ? 0
      : afterIntro < slowN * slowMs
        ? Math.floor(afterIntro / slowMs) + 1
        : Math.min(B, slowN + Math.floor((afterIntro - slowN * slowMs) / fastMs) + 1);
  const finished = t >= duration - outro;
  const shown = finished ? B : count;
  const current = shown > 0 ? a.shuffles[shown - 1] : null;
  const real = a.observed.value;
  const beats = a.shuffles.slice(0, shown).filter((s) => s.value >= real).length;
  const totalBeats = a.shuffles.filter((s) => s.value >= real).length;

  // dot histogram, 30 bins like the R animation
  const all = [...a.shuffles.map((s) => s.value), real];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const bins = 30;
  const binOf = (v: number) => Math.min(bins - 1, Math.floor(((v - lo) / (hi - lo || 1)) * bins));
  const heights = new Array(bins).fill(0);
  const dots = a.shuffles.slice(0, shown).map((s) => ({ bin: binOf(s.value), level: heights[binOf(s.value)]++, beat: s.value >= real }));
  const maxLevel = Math.max(8, ...a.shuffles.map((s) => s.value).reduce((h, v) => { h[binOf(v)]++; return h; }, new Array(bins).fill(0)));
  const hw = 1000;
  const hh = 300;
  const hm = { top: 26, right: 24, bottom: 52, left: 24 };
  const hiw = hw - hm.left - hm.right;
  const hih = hh - hm.top - hm.bottom;
  const binW = hiw / bins;
  const r = Math.min(binW / 2 - 1, hih / maxLevel / 2);
  const xv = (v: number) => hm.left + ((v - lo) / (hi - lo || 1)) * hiw;
  const identity = a.meanOffer.map((_, i) => i);

  return (
    <div className="grid h-full grid-cols-[1000px_1fr] gap-5">
      <div className="flex flex-col gap-3">
        <div className="card grid grid-cols-2 gap-2 px-3 pt-2">
          <MiniBars a={a} order={identity} at={a.observed.at} label="The real order" value={real} width={480} priceCap={priceCap} animate={false} />
          {current ? (
            <MiniBars
              a={a}
              order={current.order}
              at={current.at}
              label={`Shuffled world #${shown}`}
              value={current.value}
              width={480}
              priceCap={priceCap}
              animate={count <= slowN}
            />
          ) : (
            <div className="flex items-center justify-center text-xl text-ink-3">Average offer of each round…</div>
          )}
        </div>
        <div className="card px-3 pt-2">
          <svg width={hw - 24} height={hh} role="img" aria-label="Biggest jump in each shuffled world">
            <line x1={hm.left} x2={hm.left + hiw} y1={hm.top + hih} y2={hm.top + hih} stroke={C.axis} />
            {dots.map((d, i) => (
              <circle
                key={i}
                cx={hm.left + binW * (d.bin + 0.5)}
                cy={hm.top + hih - r - d.level * 2 * r}
                r={r}
                fill={d.beat ? "var(--maroon)" : "#a9a6a0"}
                stroke="#fff"
                strokeWidth={1}
              />
            ))}
            <line x1={xv(real)} x2={xv(real)} y1={hm.top - 8} y2={hm.top + hih} stroke="var(--maroon)" strokeWidth={3} />
            <text x={xv(real) - 8} y={hm.top + 8} textAnchor="end" fontSize={16} fontWeight={700} fill="var(--maroon)">
              real order {eur(real, 1)}
            </text>
            {[lo, (lo + hi) / 2, hi].map((v, i) => (
              <text
                key={i}
                x={xv(v)}
                y={hm.top + hih + 22}
                textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
                fontSize={14}
                fill={C.text}
                className="tabular"
              >
                {eur(v, 0)}
              </text>
            ))}
            <text x={hm.left + hiw / 2} y={hh - 6} textAnchor="middle" fontSize={15} fill={C.text}>
              Biggest jump in the average offer, in each shuffled world
            </text>
          </svg>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="card p-6 text-xl leading-relaxed text-ink-2">
          If nothing special happened, the order of the rounds would not matter: we could <b className="text-ink">shuffle
          them</b> and the data would look just as believable. Each shuffle is one world where nothing happened.
          <span className="mt-2 block">
            Grey dot: a shuffled world. <b style={{ color: "var(--maroon)" }}>Red</b>: a shuffle with a jump as big as the real one.
          </span>
        </div>
        <div className="card grid grid-cols-2 gap-2 p-5 text-center">
          <div>
            <div className="text-base text-ink-3">Shuffled worlds</div>
            <div className="tabular text-5xl font-bold text-navy">{shown}</div>
          </div>
          <div>
            <div className="text-base text-ink-3">As big as reality</div>
            <div className="tabular text-5xl font-bold" style={{ color: "var(--maroon)" }}>{beats}</div>
          </div>
        </div>
        {finished && (
          <div className="rounded-2xl bg-navy p-6 text-white">
            <div className="tabular text-3xl font-bold whitespace-nowrap">
              p = (1 + {totalBeats}) / ({B} + 1) = {a.permutationP.toFixed(3)}
            </div>
            <div className="mt-2 text-lg opacity-90">
              Only {totalBeats} of {B} shuffled worlds jump as much as the real game. The real order is special: something changed.
            </div>
          </div>
        )}
        <p className="mt-auto text-sm text-ink-3">
          Shuffling assumes the rounds are interchangeable when nothing happens. With long, autocorrelated series we would
          shuffle in blocks or on the residuals of a time-series model.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 4. offer vs profit

function ScatterStep({ a, priceCap, run, done, onDone }: StepProps) {
  const n = a.panel.rounds.length;
  const perRound = 1500;
  const duration = n * perRound + 600;
  const t = useClock(duration, run, done);
  useEffect(() => {
    if (t >= duration && !done) onDone();
  }, [t, duration, done, onDone]);
  const current = Math.max(0, Math.min(n - 1, Math.floor(t / perRound)));
  const finished = t >= duration;

  const w = 1000;
  const h = 640;
  const m = { top: 30, right: 30, bottom: 60, left: 90 };
  const iw = w - m.left - m.right;
  const ih = h - m.top - m.bottom;
  const maxProfit = Math.max(...a.panel.profit.flat(), 1);
  const yTop = Math.ceil((maxProfit * 1.08) / 2000) * 2000;
  const x = (v: number) => m.left + (v / (priceCap * 1.04)) * iw;
  const plant = PLANT_MW;
  const y = (v: number) => m.top + ih - (v / yTop) * ih;

  // Shades by round within each part: early rounds lighter, later rounds darker.
  const shade = (i: number) => {
    const r = a.panel.rounds[i];
    const same = a.panel.rounds.filter((q) => q.phase === r.phase);
    const k = same.findIndex((q) => q.number === r.number);
    const [hue, sat, light0, light1] = r.phase === "collusion" ? [22, 100, 0.68, 0.4] : [235, 62, 0.66, 0.24];
    const lightness = same.length > 1 ? light0 - ((light0 - light1) * k) / (same.length - 1) : light1;
    return `hsl(${hue} ${sat}% ${Math.round(lightness * 100)}%)`;
  };

  const avg = (phase: Phase, M: number[][]) => {
    const rows = a.panel.rounds.map((r, i) => (r.phase === phase ? M[i] : [])).flat();
    return rows.length ? rows.reduce((s, v) => s + v, 0) / rows.length : 0;
  };
  const r = a.panel.rounds[current];

  return (
    <div className="grid h-full grid-cols-[1000px_1fr] gap-5">
      <div className="card relative px-2 pt-2">
        <svg width={w - 16} height={h} role="img" aria-label="Offer against profit, team by team, round by round">
          {ticks(yTop, 5).map((v) => (
            <g key={v}>
              <line x1={m.left} x2={m.left + iw} y1={y(v)} y2={y(v)} stroke={C.grid} />
              <text x={m.left - 10} y={y(v)} dy="0.32em" textAnchor="end" fontSize={15} fill={C.text} className="tabular">
                €{v.toLocaleString("en-GB")}
              </text>
            </g>
          ))}
          {ticks(priceCap, 5).map((v) => (
            <text key={v} x={x(v)} y={m.top + ih + 24} textAnchor="middle" fontSize={15} fill={C.text} className="tabular">
              €{v}
            </text>
          ))}
          <line x1={m.left} x2={m.left + iw} y1={y(0)} y2={y(0)} stroke={C.axis} />
          {/* A team that sells its whole plant earns offer × 100 MW; one that is not bought earns 0. */}
          <line x1={x(0)} y1={y(0)} x2={x(Math.min(priceCap, yTop / plant))} y2={y(Math.min(priceCap, yTop / plant) * plant)} stroke={C.axis} strokeWidth={1.5} strokeDasharray="6 5" />
          <text
            x={x(Math.min(priceCap, yTop / plant) * 0.55)}
            y={y(Math.min(priceCap, yTop / plant) * 0.55 * plant) - 12}
            fontSize={15}
            fill={C.text}
            transform={`rotate(${(-Math.atan2(y(0) - y(yTop / 2), x(yTop / 2 / plant) - x(0)) * 180) / Math.PI} ${x(Math.min(priceCap, yTop / plant) * 0.55)} ${y(Math.min(priceCap, yTop / plant) * 0.55 * plant) - 12})`}
          >
            sold the whole plant ({plant} MW)
          </text>
          <text x={m.left + iw - 4} y={y(0) - 10} textAnchor="end" fontSize={15} fill={C.text}>not bought: €0</text>
          <text x={m.left + iw} y={h - 8} textAnchor="end" fontSize={15} fill={C.text}>Offer (€/MWh)</text>
          <text x={m.left} y={m.top - 12} fontSize={15} fill={C.text}>Profit (€)</text>
          {a.panel.rounds.map((_, i) =>
            i > current
              ? null
              : a.panel.bid[i].map((b, t2) => {
                  const now = i === current && !finished;
                  return (
                    <circle
                      key={`${i}-${t2}`}
                      cx={x(b)}
                      cy={y(a.panel.profit[i][t2])}
                      r={now ? 12 : 7}
                      fill={shade(i)}
                      opacity={now ? 0.95 : 0.55}
                      stroke="#fff"
                      strokeWidth={now ? 2.5 : 1}
                    />
                  );
                }),
          )}
        </svg>
        <div className="absolute top-14 left-28 rounded-xl bg-white/90 px-4 py-2 shadow-sm">
          <div className="text-3xl font-bold text-ink">Round {r.number}</div>
          <div className="text-lg text-ink-2">
            {hour(r.label)} · {r.phase === "collusion" ? "Part 2" : "Part 1"}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <div className="card p-6 text-xl leading-relaxed text-ink-2">
          Each dot is <b className="text-ink">one team in one round</b>: how much it asked and how much it earned. Earlier
          rounds stay on screen, fainter, so the cloud builds up.
        </div>
        <div className="card flex flex-wrap gap-2 p-5">
          {a.panel.rounds.map((q, i) => (
            <span
              key={q.number}
              className={`rounded-full px-3 py-1 text-base font-semibold text-white ${i > current ? "opacity-25" : ""}`}
              style={{ background: shade(i), outline: i === current ? "3px solid var(--ink)" : undefined }}
            >
              R{q.number}
            </span>
          ))}
        </div>
        {finished && (
          <div className="rounded-2xl bg-navy p-6 text-xl text-white">
            <div>
              Average offer: <b className="tabular">{eur(avg("competition", a.panel.bid))}</b> →{" "}
              <b className="tabular text-orange">{eur(avg("collusion", a.panel.bid))}</b>
            </div>
            <div className="mt-1">
              Average profit per team and round: <b className="tabular">{eur(avg("competition", a.panel.profit))}</b> →{" "}
              <b className="tabular text-orange">{eur(avg("collusion", a.panel.profit))}</b>
            </div>
            <div className="mt-2 text-base opacity-80">Part 1 → Part 2. Higher prices for everybody: that is what consumers pay.</div>
          </div>
        )}
      </div>
    </div>
  );
}

