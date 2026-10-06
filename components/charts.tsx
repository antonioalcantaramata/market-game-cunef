"use client";

import { useState } from "react";
import type { BidView, GroupView, RoundView } from "@/lib/types";
import { PHASE_LABEL, type Phase } from "@/lib/game";
import { eur, mw, useWidth } from "./client";
import { PHASE_COLOR } from "./ui";

export const C = {
  sold: "var(--navy)",
  unsold: "var(--sand)",
  demand: "var(--orange)",
  grid: "var(--line)",
  axis: "var(--ink-3)",
  text: "var(--ink-2)",
  strong: "var(--ink)",
};

function niceStep(range: number, target: number) {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
}

export function ticks(max: number, target: number) {
  const step = niceStep(max, target);
  const out: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

/** Rectangle with rounded top corners only, anchored to the baseline. */
export function topRounded(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: React.ReactNode }) {
  const left = Math.min(Math.max(x, 90), width - 90);
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-lg"
      style={{ left, top: y - 8, minWidth: 160 }}
    >
      {children}
    </div>
  );
}

export function LegendSwatch({ color, kind = "box", outline }: { color: string; kind?: "box" | "line" | "dash"; outline?: boolean }) {
  if (kind === "box")
    return (
      <span
        className="inline-block h-3 w-3 rounded-[3px]"
        style={{ background: outline ? "transparent" : color, border: outline ? `2.5px solid ${color}` : undefined }}
      />
    );
  return (
    <span
      className="inline-block w-5"
      style={{ borderTop: `${kind === "line" ? 3 : 2}px ${kind === "dash" ? "dashed" : "solid"} ${color}` }}
    />
  );
}

// ---------------------------------------------------------------- merit order

export function MeritOrderChart({
  bids,
  groups,
  demand,
  clearingPrice,
  priceLabel = "Average price",
  priceCap,
  highlightGroupId,
  height = 360,
  large = false,
}: {
  bids: BidView[];
  groups: GroupView[];
  demand: number;
  clearingPrice: number | null;
  priceLabel?: string;
  priceCap: number;
  highlightGroupId?: number;
  height?: number;
  large?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const byId = new Map(groups.map((g) => [g.id, g]));
  const fs = large ? 15 : 12;

  const offers = bids
    .filter((b) => b.quantity > 0)
    .sort((a, b) => a.price - b.price || (byId.get(a.groupId)?.slot ?? 0) - (byId.get(b.groupId)?.slot ?? 0));
  const blocks = offers.reduce<{ bid: BidView; group?: GroupView; x0: number; x1: number }[]>((acc, b) => {
    const x0 = acc.length ? acc[acc.length - 1].x1 : 0;
    return [...acc, { bid: b, group: byId.get(b.groupId), x0, x1: x0 + b.quantity }];
  }, []);
  const cum = blocks.length ? blocks[blocks.length - 1].x1 : 0;

  const m = { top: large ? 48 : 40, right: 18, bottom: large ? 44 : 38, left: large ? 62 : 50 };
  const iw = Math.max(0, width - m.left - m.right);
  const ih = height - m.top - m.bottom;
  const xMax = Math.max(cum, demand, 1) * 1.04;
  const maxPrice = Math.max(clearingPrice ?? 0, ...offers.map((o) => o.price), 20);
  const yMax = Math.min(priceCap * 1.12, Math.ceil((maxPrice * 1.15) / 20) * 20);
  const x = (v: number) => m.left + (v / xMax) * iw;
  const y = (v: number) => m.top + ih - (v / yMax) * ih;

  const hovered = blocks.find((b) => b.bid.groupId === hover);

  return (
    <div className="w-full">
      <div className={`mb-2 flex flex-wrap gap-x-4 gap-y-1 ${large ? "text-sm" : "text-xs"} text-ink-2`}>
        <span className="flex items-center gap-1.5"><LegendSwatch color={C.sold} /> Sold</span>
        <span className="flex items-center gap-1.5"><LegendSwatch color={C.unsold} /> Not sold</span>
        <span className="flex items-center gap-1.5">
          <LegendSwatch color={C.demand} kind="line" /> Demand <b className="tabular text-ink">{mw(demand)}</b>
        </span>
        {clearingPrice != null && (
          <span className="flex items-center gap-1.5">
            <LegendSwatch color={C.strong} kind="dash" /> {priceLabel} <b className="tabular text-ink">{eur(clearingPrice)}/MWh</b>
          </span>
        )}
        {highlightGroupId != null && (
          <span className="flex items-center gap-1.5"><LegendSwatch color={C.demand} outline /> Your offer</span>
        )}
      </div>
      <div ref={ref} className="relative w-full" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label="Merit order: offers sorted from cheapest to most expensive">
            {ticks(yMax, 5).map((t) => (
              <g key={t}>
                <line x1={m.left} x2={m.left + iw} y1={y(t)} y2={y(t)} stroke={C.grid} />
                <text x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={fs} fill={C.text} className="tabular">
                  €{t}
                </text>
              </g>
            ))}
            {ticks(xMax, large ? 8 : 5).map((t) => (
              <text key={t} x={x(t)} y={m.top + ih + fs + 6} textAnchor="middle" fontSize={fs} fill={C.text} className="tabular">
                {t}
              </text>
            ))}
            <text x={m.left} y={m.top - (large ? 34 : 28)} fontSize={fs} fill={C.text}>€/MWh</text>
            <text x={m.left + iw} y={height - 4} textAnchor="end" fontSize={fs} fill={C.text}>
              MW offered (cheapest first)
            </text>
            <line x1={m.left} x2={m.left + iw} y1={y(0)} y2={y(0)} stroke={C.axis} />

            {blocks.map(({ bid, group, x0, x1 }) => {
              const gap = 1;
              const bx = x(x0) + gap;
              const bw = Math.max(1, x(x1) - x(x0) - 2 * gap);
              const top = Math.min(y(bid.price), y(0) - 3);
              const h = y(0) - top;
              const soldW = bw * Math.min(1, (bid.dispatched ?? 0) / bid.quantity);
              const isMine = bid.groupId === highlightGroupId;
              const dim = hover != null && hover !== bid.groupId;
              return (
                <g
                  key={bid.groupId}
                  opacity={dim ? 0.55 : 1}
                  onMouseEnter={() => setHover(bid.groupId)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setHover(hover === bid.groupId ? null : bid.groupId)}
                >
                  <clipPath id={`clip-${bid.groupId}`}>
                    <path d={topRounded(bx, top, bw, h, 4)} />
                  </clipPath>
                  <g clipPath={`url(#clip-${bid.groupId})`}>
                    <rect x={bx} y={top} width={bw} height={h} fill={C.unsold} />
                    <rect x={bx} y={top} width={soldW} height={h} fill={C.sold} />
                  </g>
                  {isMine && <path d={topRounded(bx, top, bw, h, 4)} fill="none" stroke={C.demand} strokeWidth={3} />}
                  {bw >= 20 &&
                    (bid.anonLabel ? (
                      <text x={bx + bw / 2} y={top - 6} textAnchor="middle" fontSize={large ? 18 : 13} fontWeight={700} fill={C.strong}>
                        {bid.anonLabel}
                      </text>
                    ) : (
                      <text x={bx + bw / 2} y={top - 6} textAnchor="middle" fontSize={large ? 20 : 15}>
                        {group?.icon}
                      </text>
                    ))}
                  {bw >= 34 && (
                    <text
                      x={bx + bw / 2}
                      y={top - (large ? 30 : 24)}
                      textAnchor="middle"
                      fontSize={fs - 1}
                      fill={C.text}
                      className="tabular"
                    >
                      €{bid.price}
                    </text>
                  )}
                  {/* Larger invisible hit target */}
                  <rect x={bx} y={m.top} width={bw} height={ih} fill="transparent" />
                </g>
              );
            })}

            {clearingPrice != null && (
              <g>
                <line x1={m.left} x2={m.left + iw} y1={y(clearingPrice)} y2={y(clearingPrice)} stroke={C.strong} strokeWidth={1.5} strokeDasharray="6 4" />
              </g>
            )}
            <line x1={x(demand)} x2={x(demand)} y1={m.top - 6} y2={y(0)} stroke={C.demand} strokeWidth={2.5} />
            {clearingPrice != null && (
              <circle cx={x(demand)} cy={y(clearingPrice)} r={5} fill={C.demand} stroke="#fff" strokeWidth={2} />
            )}
          </svg>
        )}
        {hovered && (
          <Tooltip x={x((hovered.x0 + hovered.x1) / 2)} y={Math.min(y(hovered.bid.price), y(0) - 3) - 30} width={width}>
            <div className="font-semibold text-ink">
              {hovered.bid.anonLabel
                ? `Company ${hovered.bid.anonLabel} (anonymous)`
                : `${hovered.group?.icon} ${hovered.group?.displayName} · ${hovered.group?.technology}`}
            </div>
            <div className="tabular mt-1 grid grid-cols-[auto_auto] gap-x-3 text-ink-2">
              <span>Offer</span><span className="text-right">{eur(hovered.bid.price)}/MWh</span>
              {hovered.bid.dispatched != null && (
                <><span>Sold</span><span className="text-right">{mw(hovered.bid.dispatched)}</span></>
              )}
              {hovered.bid.profit != null && (
                <><span>Earned</span><span className="text-right font-semibold text-ink">{eur(hovered.bid.profit)}</span></>
              )}
            </div>
          </Tooltip>
        )}
      </div>
      {offers.length === 0 && <p className="mt-2 text-sm text-ink-3">No offers in this round.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- price history

export function PriceHistoryChart({
  rounds,
  priceCap,
  priceLabel = "Average price",
  height = 260,
  large = false,
}: {
  rounds: RoundView[];
  priceCap: number;
  priceLabel?: string;
  height?: number;
  large?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const closed = rounds.filter((r) => r.status === "closed" && r.clearingPrice != null);
  const fs = large ? 15 : 12;
  const phases = [...new Set(closed.map((r) => r.phase))] as Phase[];

  const m = { top: large ? 30 : 26, right: 24, bottom: large ? 40 : 34, left: large ? 62 : 50 };
  const iw = Math.max(0, width - m.left - m.right);
  const ih = height - m.top - m.bottom;
  const yMax = priceCap * 1.2;
  const n = Math.max(closed.length, 1);
  const step = iw / n;
  const x = (i: number) => m.left + step * (i + 0.5);
  const y = (v: number) => m.top + ih - (v / yMax) * ih;

  // Contiguous phase bands, labelled directly so identity never relies on colour alone.
  const bands: { phase: Phase; from: number; to: number }[] = [];
  closed.forEach((r, i) => {
    const last = bands[bands.length - 1];
    if (last && last.phase === r.phase) last.to = i;
    else bands.push({ phase: r.phase, from: i, to: i });
  });
  const bandFill: Record<Phase, string> = { practice: "#f4f3f1", competition: "#eef3fb", collusion: "#fff0e6" };
  const hovered = hover != null ? closed[hover] : null;

  return (
    <div className="w-full">
      <div className={`mb-2 flex flex-wrap gap-x-4 gap-y-1 ${large ? "text-sm" : "text-xs"} text-ink-2`}>
        {phases.map((p) => (
          <span key={p} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: PHASE_COLOR[p] }} />
            {PHASE_LABEL[p]}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <LegendSwatch color={C.axis} kind="dash" /> Price cap <b className="tabular text-ink">{eur(priceCap)}</b>
        </span>
      </div>
      <div
        ref={ref}
        className="relative w-full"
        style={{ height }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          if (!closed.length) return;
          const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
          setHover(Math.max(0, Math.min(closed.length - 1, Math.floor((px - m.left) / step))));
        }}
      >
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label="Market price in every round">
            {bands.map((b) => (
              <g key={b.from}>
                <rect x={m.left + step * b.from} y={m.top} width={step * (b.to - b.from + 1)} height={ih} fill={bandFill[b.phase]} />
                <text x={m.left + step * b.from + 4} y={m.top - 8} fontSize={fs - 1} fontWeight={600} fill={C.text}>
                  {PHASE_LABEL[b.phase]}
                </text>
              </g>
            ))}
            {ticks(priceCap, 4).map((t) => (
              <g key={t}>
                <line x1={m.left} x2={m.left + iw} y1={y(t)} y2={y(t)} stroke={C.grid} strokeOpacity={0.7} />
                <text x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={fs} fill={C.text} className="tabular">
                  €{t}
                </text>
              </g>
            ))}
            <line x1={m.left} x2={m.left + iw} y1={y(priceCap)} y2={y(priceCap)} stroke={C.axis} strokeDasharray="2 4" />
            <line x1={m.left} x2={m.left + iw} y1={y(0)} y2={y(0)} stroke={C.axis} />
            {closed.map((r, i) => (
              <text key={r.id} x={x(i)} y={m.top + ih + fs + 6} textAnchor="middle" fontSize={fs} fill={C.text}>
                R{r.number}
              </text>
            ))}
            {hovered && <line x1={x(hover!)} x2={x(hover!)} y1={m.top} y2={y(0)} stroke={C.axis} />}
            <polyline
              points={closed.map((r, i) => `${x(i)},${y(r.clearingPrice!)}`).join(" ")}
              fill="none"
              stroke={C.text}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            {closed.map((r, i) => (
              <circle
                key={r.id}
                cx={x(i)}
                cy={y(r.clearingPrice!)}
                r={hover === i ? 7 : 5.5}
                fill={PHASE_COLOR[r.phase]}
                stroke="#fff"
                strokeWidth={2}
              />
            ))}
            {closed.length > 0 && hover == null && (
              <text
                x={x(closed.length - 1)}
                y={y(closed[closed.length - 1].clearingPrice!) - 12}
                textAnchor="middle"
                fontSize={fs}
                fontWeight={700}
                fill={C.strong}
                className="tabular"
              >
                {eur(closed[closed.length - 1].clearingPrice!)}
              </text>
            )}
          </svg>
        )}
        {hovered && (
          <Tooltip x={x(hover!)} y={y(hovered.clearingPrice!)} width={width}>
            <div className="font-semibold text-ink">Round {hovered.number} · {hovered.label}</div>
            <div className="tabular mt-1 grid grid-cols-[auto_auto] gap-x-3 text-ink-2">
              <span>{priceLabel}</span><span className="text-right font-semibold text-ink">{eur(hovered.clearingPrice!)}/MWh</span>
              {hovered.marginalPrice != null && hovered.marginalPrice !== hovered.clearingPrice && (
                <><span>Top offer bought</span><span className="text-right">{eur(hovered.marginalPrice)}/MWh</span></>
              )}
              <span>Demand</span><span className="text-right">{mw(hovered.demandMw)}</span>
              <span>Phase</span><span className="text-right">{PHASE_LABEL[hovered.phase]}</span>
            </div>
          </Tooltip>
        )}
        {closed.length === 0 && width > 0 && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-ink-3">No rounds played yet.</p>
        )}
      </div>
    </div>
  );
}
