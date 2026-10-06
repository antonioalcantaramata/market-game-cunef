"use client";

// Summaries for the projector: Part 1 on its own, and Part 1 vs Part 2.
// Everything is computed from the rounds the projector already receives, so
// Part 1 stays anonymous; names only appear for Part 2 offers.

import { useState } from "react";
import type { Phase } from "@/lib/game";
import type { RoundView, SessionView } from "@/lib/types";
import { C, LegendSwatch, ticks, topRounded } from "./charts";
import { eur, mw, useWidth } from "./client";
import { PHASE_COLOR } from "./ui";

// ---------------------------------------------------------------- numbers

interface PartStats {
  rounds: RoundView[];
  avgPrice: number; // € per MWh actually paid, weighted by MWh
  topBought: number; // most expensive offer bought
  mwh: number; // electricity sold
  paid: number; // what consumers paid in total
  paidPerRound: number;
  offers: number;
  atCap: number; // offers at the maximum price
}

/** What consumers paid in a round: each offer bought, at its own price. */
function roundPaid(r: RoundView) {
  return r.bids.reduce((s, b) => s + b.price * (b.dispatched ?? 0), 0);
}

function roundMwh(r: RoundView) {
  return r.bids.reduce((s, b) => s + (b.dispatched ?? 0), 0);
}

function partStats(session: SessionView, phase: Phase): PartStats {
  const rounds = session.rounds.filter((r) => r.status === "closed" && r.phase === phase);
  const paid = rounds.reduce((s, r) => s + roundPaid(r), 0);
  const mwh = rounds.reduce((s, r) => s + roundMwh(r), 0);
  const offers = rounds.flatMap((r) => r.bids);
  return {
    rounds,
    avgPrice: mwh > 0 ? paid / mwh : 0,
    topBought: Math.max(0, ...rounds.map((r) => r.marginalPrice ?? r.clearingPrice ?? 0)),
    mwh,
    paid,
    paidPerRound: rounds.length ? paid / rounds.length : 0,
    offers: offers.length,
    atCap: offers.filter((b) => b.price >= session.priceCap).length,
  };
}

const pct = (a: number, b: number) => (a > 0 ? Math.round(((b - a) / a) * 100) : 0);
const hourName = (label: string) => label.split("·").pop()!.trim();

// ---------------------------------------------------------------- pieces

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="card flex flex-col justify-center px-5 py-4">
      <div className="text-base text-ink-2">{label}</div>
      <div className="tabular text-4xl font-bold text-navy">{value}</div>
      {sub && <div className="mt-0.5 text-base text-ink-3">{sub}</div>}
    </div>
  );
}

function Change({ from, to, unit = "" }: { from: number; to: number; unit?: string }) {
  const p = pct(from, to);
  return (
    <span className={`text-2xl font-bold ${p > 0 ? "text-orange" : "text-ink-3"}`}>
      {p > 0 ? "+" : ""}
      {p}%{unit}
    </span>
  );
}

/**
 * Every offer of every round as a dot (bought = filled, not bought = hollow),
 * with the average price paid as a dark tick. Shows at a glance whether
 * teams undercut each other (dots spread and drop) or line up at the top.
 */
export function OffersDotPlot({ session, rounds, height }: { session: SessionView; rounds: RoundView[]; height: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const m = { top: 30, right: 16, bottom: 44, left: 60 };
  const iw = Math.max(0, width - m.left - m.right);
  const ih = height - m.top - m.bottom;
  const yMax = session.priceCap * 1.08;
  const step = iw / Math.max(1, rounds.length);
  const xc = (i: number) => m.left + step * (i + 0.5);
  const y = (v: number) => m.top + ih - (v / yMax) * ih;
  const bandFill: Record<Phase, string> = { practice: "#f4f3f1", competition: "#eef3fb", collusion: "#fff0e6" };

  return (
    <div className="w-full">
      <div className="mb-2 flex flex-wrap gap-x-5 text-sm text-ink-2">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full" style={{ background: C.sold }} /> Offer bought
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full border-2" style={{ borderColor: C.axis }} /> Not bought
        </span>
        <span className="flex items-center gap-1.5">
          <LegendSwatch color={C.strong} kind="line" /> Average price paid
        </span>
      </div>
      <div ref={ref} style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label="Every offer in every round">
            {rounds.map((r, i) => (
              <rect key={r.id} x={m.left + step * i} y={m.top} width={step} height={ih} fill={bandFill[r.phase]} />
            ))}
            {ticks(session.priceCap, 4).map((t) => (
              <g key={t}>
                <line x1={m.left} x2={m.left + iw} y1={y(t)} y2={y(t)} stroke={C.grid} />
                <text x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={14} fill={C.text} className="tabular">
                  €{t}
                </text>
              </g>
            ))}
            {rounds.map((r, i) => {
              const offers = [...r.bids].sort((a, b) => a.price - b.price);
              const spread = Math.min(step * 0.7, offers.length * 9);
              const tick = Math.min(step * 0.42, 34);
              // Shrink the dots when many offers share a narrow column.
              const radius = Math.max(3, Math.min(6, (spread / Math.max(1, offers.length - 1)) * 0.75));
              return (
                <g key={r.id}>
                  {offers.map((b, k) => {
                    const dx = offers.length > 1 ? -spread / 2 + (spread * k) / (offers.length - 1) : 0;
                    const sold = (b.dispatched ?? 0) > 0;
                    return (
                      <circle
                        key={k}
                        cx={xc(i) + dx}
                        cy={y(b.price)}
                        r={radius}
                        fill={sold ? C.sold : "#fff"}
                        stroke={sold ? "#fff" : C.axis}
                        strokeWidth={radius > 4 ? 2 : 1.25}
                      />
                    );
                  })}
                  {r.clearingPrice != null && (
                    <line x1={xc(i) - tick} x2={xc(i) + tick} y1={y(r.clearingPrice)} y2={y(r.clearingPrice)} stroke={C.strong} strokeWidth={3} strokeLinecap="round" />
                  )}
                  <text x={xc(i)} y={m.top + ih + 18} textAnchor="middle" fontSize={14} fill={C.text}>
                    R{r.number}
                  </text>
                  {step >= 90 && (
                    <text x={xc(i)} y={m.top + ih + 36} textAnchor="middle" fontSize={12} fill={C.axis}>
                      {hourName(r.label)}
                    </text>
                  )}
                </g>
              );
            })}
            <line x1={m.left} x2={m.left + iw} y1={y(0)} y2={y(0)} stroke={C.axis} />
            <text x={m.left} y={m.top - 12} fontSize={14} fill={C.text}>€/MWh</text>
          </svg>
        )}
      </div>
    </div>
  );
}

/** Average price paid at the same hour in Part 1 and Part 2, side by side. */
function HourComparison({ session, p1, p2, height }: { session: SessionView; p1: RoundView[]; p2: RoundView[]; height: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  // Pair rounds by their hour label; rounds without a partner still get their bar.
  const hours: { label: string; a?: RoundView; b?: RoundView }[] = [];
  for (const r of p1) hours.push({ label: r.label, a: r });
  for (const r of p2) {
    const slot = hours.find((h) => h.label === r.label && !h.b);
    if (slot) slot.b = r;
    else hours.push({ label: r.label, b: r });
  }
  const m = { top: 30, right: 16, bottom: 44, left: 60 };
  const iw = Math.max(0, width - m.left - m.right);
  const ih = height - m.top - m.bottom;
  const yMax = session.priceCap * 1.08;
  const step = iw / Math.max(1, hours.length);
  const bw = Math.min(56, step * 0.32);
  const y = (v: number) => m.top + ih - (v / yMax) * ih;

  const bar = (x: number, v: number | null | undefined, color: string) =>
    v == null ? null : (
      <g>
        <path d={topRounded(x, y(v), bw, Math.max(2, y(0) - y(v)), 4)} fill={color} />
        <text x={x + bw / 2} y={y(v) - 8} textAnchor="middle" fontSize={15} fontWeight={700} fill={C.strong} className="tabular">
          €{Math.round(v)}
        </text>
      </g>
    );

  return (
    <div className="w-full">
      <div className="mb-2 flex gap-5 text-sm text-ink-2">
        <span className="flex items-center gap-1.5"><LegendSwatch color={PHASE_COLOR.competition} /> Part 1</span>
        <span className="flex items-center gap-1.5"><LegendSwatch color={PHASE_COLOR.collusion} /> Part 2 · agreements</span>
      </div>
      <div ref={ref} style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label="Average price at the same hour, Part 1 vs Part 2">
            {ticks(session.priceCap, 4).map((t) => (
              <g key={t}>
                <line x1={m.left} x2={m.left + iw} y1={y(t)} y2={y(t)} stroke={C.grid} />
                <text x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={14} fill={C.text} className="tabular">
                  €{t}
                </text>
              </g>
            ))}
            {hours.map((h, i) => {
              const cx = m.left + step * (i + 0.5);
              return (
                <g key={i}>
                  {bar(cx - bw - 2, h.a?.clearingPrice, PHASE_COLOR.competition)}
                  {bar(cx + 2, h.b?.clearingPrice, PHASE_COLOR.collusion)}
                  <text x={cx} y={m.top + ih + 20} textAnchor="middle" fontSize={14} fill={C.text}>
                    {hourName(h.label)}
                  </text>
                </g>
              );
            })}
            <line x1={m.left} x2={m.left + iw} y1={y(0)} y2={y(0)} stroke={C.axis} />
            <text x={m.left} y={m.top - 12} fontSize={14} fill={C.text}>Average price paid, €/MWh</text>
          </svg>
        )}
      </div>
    </div>
  );
}

/**
 * Teams that offered below the price most of Part 2 agreed on (its most
 * common offer). Part 2 offers carry names, so this list is public.
 */
function dealBreakers(session: SessionView, p2: RoundView[]) {
  const offers = p2.flatMap((r) => r.bids);
  if (!offers.length) return { cartelPrice: null, list: [] };
  const counts = new Map<number, number>();
  for (const b of offers) counts.set(b.price, (counts.get(b.price) ?? 0) + 1);
  const cartelPrice = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  const times = new Map<number, number>();
  for (const b of offers) if (b.price < cartelPrice) times.set(b.groupId, (times.get(b.groupId) ?? 0) + 1);
  const names = new Map(session.groups.map((g) => [g.id, g]));
  const list = [...times.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => ({ group: names.get(id), times: n }));
  return { cartelPrice, list };
}

// ---------------------------------------------------------------- the two views

export function SummaryBody({ session }: { session: SessionView }) {
  const p1 = partStats(session, "competition");
  const p2 = partStats(session, "collusion");
  const hasP2 = p2.rounds.length > 0;
  const [tab, setTab] = useState<"auto" | "part1" | "compare">("auto");
  const view = tab === "auto" ? (hasP2 ? "compare" : "part1") : tab;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold">{view === "part1" ? "Part 1 · Summary" : "Part 1 vs Part 2"}</h2>
        {hasP2 && (
          <div className="flex rounded-lg bg-white p-1 text-base shadow-sm">
            {(["part1", "compare"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-md px-4 py-1.5 font-semibold ${view === t ? "bg-navy text-white" : "text-ink-2"}`}
              >
                {t === "part1" ? "Part 1" : "Part 1 vs Part 2"}
              </button>
            ))}
          </div>
        )}
      </div>
      {p1.rounds.length === 0 ? (
        <p className="card p-10 text-center text-2xl text-ink-2">No Part 1 rounds played yet.</p>
      ) : view === "part1" ? (
        <Part1 session={session} p1={p1} />
      ) : (
        <Compare session={session} p1={p1} p2={p2} />
      )}
    </div>
  );
}

function Part1({ session, p1 }: { session: SessionView; p1: PartStats }) {
  return (
    <>
      <div className="grid grid-cols-4 gap-4">
        <Tile label="Average price paid" value={`${eur(p1.avgPrice)}`} sub="per MWh" />
        <Tile label="Most expensive offer bought" value={eur(p1.topBought)} sub="per MWh" />
        <Tile label="Electricity sold" value={`${Math.round(p1.mwh).toLocaleString("en-GB")} MWh`} sub={`in ${p1.rounds.length} hours`} />
        <Tile label="Consumers paid" value={eur(p1.paid)} sub={`${eur(p1.paidPerRound)} per hour`} />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[1.5fr_1fr] gap-4">
        <div className="card p-5">
          <h3 className="mb-1 text-xl font-bold">Every offer, round by round</h3>
          <OffersDotPlot session={session} rounds={p1.rounds} height={420} />
        </div>
        <div className="card p-5">
          <h3 className="mb-3 text-xl font-bold">Round by round</h3>
          <table className="tabular w-full text-lg">
            <thead className="text-left text-sm text-ink-3">
              <tr>
                <th className="pb-2 font-medium">Hour</th>
                <th className="pb-2 text-right font-medium">Demand</th>
                <th className="pb-2 text-right font-medium">Avg price</th>
                <th className="pb-2 text-right font-medium">Top bought</th>
                <th className="pb-2 text-right font-medium">Sold</th>
              </tr>
            </thead>
            <tbody>
              {p1.rounds.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="py-2">{r.label}</td>
                  <td className="py-2 text-right">{mw(r.demandMw)}</td>
                  <td className="py-2 text-right font-bold">{eur(r.clearingPrice ?? 0)}</td>
                  <td className="py-2 text-right">{eur(r.marginalPrice ?? r.clearingPrice ?? 0)}</td>
                  <td className="py-2 text-right">
                    {r.bids.filter((b) => (b.dispatched ?? 0) > 0).length}/{r.bids.length}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-sm text-ink-3">«Sold»: offers bought out of offers made. Companies are anonymous in Part 1.</p>
        </div>
      </div>
    </>
  );
}

function Compare({ session, p1, p2 }: { session: SessionView; p1: PartStats; p2: PartStats }) {
  const { cartelPrice, list } = dealBreakers(session, p2.rounds);
  const capShare = (s: PartStats) => (s.offers ? Math.round((s.atCap / s.offers) * 100) : 0);
  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        <Tile
          label="Average price paid"
          value={
            <span className="flex items-baseline gap-3">
              {eur(p1.avgPrice)} → {eur(p2.avgPrice)} <Change from={p1.avgPrice} to={p2.avgPrice} />
            </span>
          }
          sub="per MWh, Part 1 → Part 2"
        />
        <Tile
          label="Consumers paid per hour"
          value={
            <span className="flex items-baseline gap-3">
              {eur(p1.paidPerRound)} → {eur(p2.paidPerRound)} <Change from={p1.paidPerRound} to={p2.paidPerRound} />
            </span>
          }
          sub="the same hours, before and after the agreements"
        />
        <Tile
          label={`Offers at the maximum (${eur(session.priceCap)})`}
          value={`${capShare(p1)}% → ${capShare(p2)}%`}
          sub="of all offers, Part 1 → Part 2"
        />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_1.25fr_0.75fr] gap-4">
        <div className="card p-5">
          <h3 className="mb-1 text-xl font-bold">Same hour, two markets</h3>
          <HourComparison session={session} p1={p1.rounds} p2={p2.rounds} height={430} />
        </div>
        <div className="card p-5">
          <h3 className="mb-1 text-xl font-bold">Every offer, before and after</h3>
          <OffersDotPlot session={session} rounds={[...p1.rounds, ...p2.rounds]} height={430} />
        </div>
        <div className="card p-5">
          <h3 className="text-xl font-bold">Who broke the deal?</h3>
          {cartelPrice != null && (
            <p className="mt-1 text-base text-ink-2">
              Most common offer in Part 2: <b className="text-ink">{eur(cartelPrice)}</b>. Offers below it:
            </p>
          )}
          {list.length === 0 ? (
            <p className="mt-4 text-xl font-semibold text-teal">Nobody. The agreement held. 🤝</p>
          ) : (
            <ol className="mt-3 flex flex-col gap-2 text-xl">
              {list.slice(0, 7).map(({ group, times }) => (
                <li key={group?.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    {group?.icon} {group?.displayName}
                  </span>
                  <span className="tabular shrink-0 font-bold text-orange">
                    {times}×
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </>
  );
}
