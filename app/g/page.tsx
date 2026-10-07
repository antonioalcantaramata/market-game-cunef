"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import useSWR from "swr";
import { MeritOrderChart } from "@/components/charts";
import { eur, formatClock, mw, mwRange, useCountdown } from "@/components/client";
import { Logo, PhaseBadge, Stat } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { rememberTeam } from "@/lib/team-memory";
import { clearMarket } from "@/lib/game";
import type { GroupState } from "@/lib/types";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <GroupPage />
    </Suspense>
  );
}

function GroupPage() {
  const code = (useSearchParams().get("code") ?? "").toUpperCase();
  const { data, error, mutate } = useSWR<GroupState>(code ? ["group", code] : null, () => api.groupState(code), {
    refreshInterval: 2000,
  });
  // Remember this phone's team, so the projector QR brings it back here.
  const sessionId = data?.session.id;
  useEffect(() => {
    if (sessionId) rememberTeam(sessionId, code);
  }, [sessionId, code]);

  if (!code || (error instanceof ApiError && error.status === 404))
    return (
      <Shell>
        <div className="card p-6 text-center">
          <p className="text-lg font-semibold">We could not find team code “{code}”.</p>
          <Link href="/" className="btn btn-primary mt-4">Try again</Link>
        </div>
      </Shell>
    );
  if (!data)
    return (
      <Shell>
        <p className="py-20 text-center text-ink-3">{error ? error.message : "Loading…"}</p>
      </Shell>
    );

  return (
    <Shell sessionName={data.session.name}>
      <PlantCard state={{ ...data, group: { ...data.group, code } }} onRename={async (name) => mutate(await api.rename(code, name), false)} />
      <CurrentRound state={data} onSubmit={async (bid) => mutate(await api.bid(code, bid), false)} />
      <History state={data} />
    </Shell>
  );
}

function Shell({ children, sessionName }: { children: React.ReactNode; sessionName?: string }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pb-12 pt-4">
      <header className="flex items-center justify-between">
        <Logo height={34} />
        {sessionName && <span className="text-sm text-ink-3">{sessionName}</span>}
      </header>
      {children}
    </main>
  );
}

function PlantCard({ state, onRename }: { state: GroupState; onRename: (name: string) => Promise<unknown> }) {
  const g = state.group;
  const [editing, setEditing] = useState(!g.name);
  const [name, setName] = useState(g.name ?? "");

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-4 bg-navy p-4 text-white">
        <span className="text-5xl" aria-hidden>{g.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm opacity-80">Your power plant</div>
          <div className="text-2xl font-bold">{g.technology}</div>
          {!editing && (
            <button className="mt-0.5 text-sm underline decoration-white/40 underline-offset-2" onClick={() => setEditing(true)}>
              {g.displayName} ✎
            </button>
          )}
        </div>
        <div className="shrink-0 rounded-lg bg-white/10 px-3 py-1.5 text-center" title="Teammates can join with this code">
          <div className="text-xs opacity-80">Team code</div>
          <div className="font-mono text-xl font-bold tracking-[0.15em]">{g.code ?? ""}</div>
        </div>
      </div>
      <p className="border-b border-line bg-sand-light px-4 py-2 text-sm text-ink-2">
        Teammates can follow the game on their phones: scan the projector QR, tap <b>“My group already has a team”</b> and
        type <b className="font-mono">{g.code}</b>.
      </p>
      {editing && (
        <form
          className="flex gap-2 border-b border-line p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            await onRename(name);
            setEditing(false);
          }}
        >
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Choose a team name" maxLength={24} autoFocus />
          <button className="btn btn-primary">Save</button>
          {g.name && <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>}
        </form>
      )}
      <div className="grid grid-cols-2 gap-4 p-4">
        <Stat label="Your plant" value={mw(g.capacity)} sub="Every plant is the same size" />
        <Stat label="How you earn" value="Your price" sub="If your offer is bought, you are paid the price you asked for" />
      </div>
    </section>
  );
}

function CurrentRound({
  state,
  onSubmit,
}: {
  state: GroupState;
  onSubmit: (bid: { roundId: number; price: number }) => Promise<unknown>;
}) {
  const r = state.current;
  if (!state.group.active)
    return (
      <section className="card p-6 text-center">
        <div className="text-lg font-semibold">Your team is paused</div>
        <p className="mt-1 text-ink-2">Ask the instructor if you want to join back in.</p>
      </section>
    );
  if (!r)
    return (
      <section className="card p-6 text-center">
        <div className="text-lg font-semibold">Waiting for the first round…</div>
        <p className="mt-1 text-ink-2">Keep this page open. It updates by itself.</p>
      </section>
    );
  if (r.status === "closed") return <RoundResult state={state} />;
  // Keyed by round so the form starts fresh (or from the saved offer) each round.
  return <OfferForm key={r.id} state={state} onSubmit={onSubmit} />;
}

function OfferForm({
  state,
  onSubmit,
}: {
  state: GroupState;
  onSubmit: (bid: { roundId: number; price: number }) => Promise<unknown>;
}) {
  const r = state.current!;
  const g = state.group;
  const left = useCountdown(r.deadline, state.serverTime);
  const [price, setPrice] = useState(r.myBid ? String(r.myBid.price) : "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const p = Number(price);
  const valid = price !== "" && p >= 0 && p <= state.session.priceCap;
  const timeUp = left === 0;
  const fmt1 = (v: number) => v.toLocaleString("en-GB", { maximumFractionDigits: 1 });
  const plantsNeeded =
    r.demandKnown ? fmt1(r.demandMw / g.capacity) : `${fmt1(r.demandLow / g.capacity)}–${fmt1(r.demandHigh / g.capacity)}`;

  return (
    <section className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <PhaseBadge phase={r.phase} />
          <h2 className="mt-1.5 text-xl font-bold">Round {r.number} · {r.label}</h2>
        </div>
        {left != null && (
          <div className={`tabular rounded-lg px-3 py-1 text-2xl font-bold ${left <= 15 ? "bg-orange text-white" : "bg-sand-light text-navy"}`}>
            {formatClock(left)}
          </div>
        )}
      </div>

      {r.phase === "collusion" && (
        <p className="mt-3 rounded-lg bg-orange/10 p-3 text-sm text-ink">
          🤝 <b>New rule:</b> you may now talk to the other teams and agree on prices. Will everyone keep their word?
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-4 rounded-lg bg-sand-light p-3">
        <Stat
          label={r.demandKnown ? "Demand this hour" : "Demand forecast"}
          value={
            r.demandKnown ? mw(r.demandMw) : <span className="text-xl whitespace-nowrap">{mwRange(r.demandLow, r.demandHigh)}</span>
          }
          sub={`Enough for ${plantsNeeded} of the ${state.session.playingCount} plants`}
        />
        <Stat label="Maximum price" value={eur(state.session.priceCap)} sub="per MWh" />
      </div>

      {!r.demandKnown && (
        <p className="mt-2 text-sm text-ink-2">
          🎲 Nobody knows the exact demand yet. The real value is somewhere in this range and will be revealed when the
          round closes.
        </p>
      )}

      <form
        className="mt-4 flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage(null);
          try {
            await onSubmit({ roundId: r.id, price: p });
            setMessage({ ok: true, text: "Offer received. You can change it until the round closes." });
          } catch (err) {
            setMessage({ ok: false, text: err instanceof Error ? err.message : "Could not send your offer" });
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Your price (€/MWh)</span>
          <input
            className="input tabular text-2xl font-bold"
            type="number"
            inputMode="decimal"
            min={0}
            max={state.session.priceCap}
            step="any"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder={`0 – ${state.session.priceCap}`}
          />
          {price !== "" && (
            <span className="text-sm text-ink-2">
              If your offer is bought, you earn <b className="text-ink">{eur(p * g.capacity)}</b> this hour. Ask too much
              and someone cheaper may take your place.
            </span>
          )}
        </label>
        <button className="btn btn-accent py-3 text-lg" disabled={!valid || busy || timeUp}>
          {timeUp ? "Time is up" : r.myBid ? "Update my offer" : "Send my offer"}
        </button>
        {message && <p className={`text-sm ${message.ok ? "text-teal" : "text-maroon"}`}>{message.text}</p>}
        {r.myBid && !message && (
          <p className="text-sm text-teal">
            ✓ Offer saved: {eur(r.myBid.price)}/MWh.
          </p>
        )}
      </form>
    </section>
  );
}

function RoundResult({ state }: { state: GroupState }) {
  const r = state.current!;
  const mine = r.bids.find((b) => b.groupId === state.group.id);
  const profit = mine?.profit ?? 0;
  const sold = mine?.dispatched ?? 0;
  const soldNote = !mine
    ? "no offer sent"
    : sold >= mine.quantity
      ? "all of it"
      : sold > 0
        ? r.bids.some((b) => b.groupId !== mine.groupId && b.price === mine.price)
          ? "part of it (tie, shared)"
          : "part of it (only this much was needed)"
        : "too expensive, not bought";

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between">
        <div>
          <PhaseBadge phase={r.phase} />
          <h2 className="mt-1.5 text-xl font-bold">Round {r.number} results</h2>
        </div>
        <span className="text-sm text-ink-3">Next round soon…</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 rounded-lg bg-sand-light p-3">
        <Stat label="Your price" value={mine ? eur(mine.price) : "—"} sub="per MWh" />
        <Stat label="You sold" value={mw(sold)} sub={soldNote} />
        <Stat label={`You earned${r.phase === "practice" ? " (practice)" : ""}`} value={eur(profit)} />
      </div>
      {mine && <WhatIf state={state} />}
      {r.demandSpread > 0 && (
        <p className="mt-3 rounded-lg bg-sky/50 p-3 text-sm">
          🎲 Real demand this hour: <b>{mw(r.demandMw)}</b> (forecast was {mwRange(r.demandLow, r.demandHigh)}).
        </p>
      )}
      <div className="mt-4">
        <MeritOrderChart
          bids={r.bids}
          groups={state.groups}
          demand={r.demandMw}
          clearingPrice={r.clearingPrice}
          priceCap={state.session.priceCap}
          highlightGroupId={state.group.id}
          height={260}
        />
      </div>
      {r.phase !== "collusion" && (
        <p className="mt-2 text-xs text-ink-3">Other companies are shown as letters (A, B, C…), reshuffled every round. Yours is outlined.</p>
      )}
      <p className="mt-3 text-sm text-ink-2">
        The cheapest offers are bought until demand is covered, and each team that sells is paid its own price. The most
        expensive offer bought this hour was <b className="text-ink">{eur(r.marginalPrice ?? 0)}</b>.
      </p>
    </section>
  );
}

const euros = (v: number) => eur(v, Number.isInteger(v) ? 0 : 2);

/**
 * "What if" for the round just closed: the team's result had it asked 1 €
 * less or 1 € more, everyone else unchanged. Recomputed in the browser with
 * the same clearing rule (lib/game.ts), from the offers already published.
 */
function WhatIf({ state }: { state: GroupState }) {
  const r = state.current!;
  const me = state.group;
  const mine = r.bids.find((b) => b.groupId === me.id)!;
  // Offers that took part in the clearing (a paused team's offer has no result).
  const cleared = r.bids.filter((b) => b.dispatched != null);
  if (!cleared.some((b) => b.groupId === me.id)) return null;

  const outcome = (price: number) => {
    const offers = cleared.map((b) => ({
      groupId: b.groupId,
      price: b.groupId === me.id ? price : b.price,
      quantity: b.quantity,
    }));
    const d = clearMarket(r.demandMw, offers).dispatch;
    return d.find((x) => x.groupId === me.id)!;
  };

  const actual = mine.profit ?? 0;
  const rows = [-1, 1].map((delta) => {
    const price = Math.round((mine.price + delta) * 100) / 100;
    if (price < 0 || price > state.session.priceCap) return { delta, price, allowed: false as const };
    const o = outcome(price);
    return { delta, price, allowed: true as const, sold: o.dispatched, earned: o.profit, diff: o.profit - actual };
  });

  return (
    <div className="mt-3 rounded-lg border border-line p-3 text-sm">
      <div className="font-semibold">What if you had asked…</div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {rows.map((row) => (
          <li key={row.delta} className="rounded-md bg-sand-light px-2.5 py-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="whitespace-nowrap">
                <b>{euros(row.price)}</b> <span className="text-ink-3">· {row.delta < 0 ? "1 € less" : "1 € more"}</span>
              </span>
              {row.allowed && (
                <b className={`tabular whitespace-nowrap ${row.diff > 0.005 ? "text-teal" : row.diff < -0.005 ? "text-maroon" : "text-ink-3"}`}>
                  {Math.abs(row.diff) < 0.005 ? "same" : `${row.diff > 0 ? "+" : "−"}${eur(Math.abs(row.diff))}`}
                </b>
              )}
            </div>
            <div className="tabular text-ink-2">
              {!row.allowed
                ? row.price < 0
                  ? "not possible"
                  : "above the maximum price"
                : `you would have sold ${mw(row.sold)} and earned ${eur(row.earned)}`}
            </div>
          </li>
        ))}
      </ul>
      {(mine.dispatched ?? 0) === 0 && r.marginalPrice != null && (
        <div className="mt-1.5">
          To sell anything you needed to ask <b>{euros(r.marginalPrice)}</b> or less (the most expensive offer bought).
        </div>
      )}
      <div className="mt-1 text-xs text-ink-3">Assuming every other team had made the same offer.</div>
    </div>
  );
}

function History({ state }: { state: GroupState }) {
  if (state.history.length === 0) return null;
  return (
    <section className="card p-4">
      <div className="flex items-end justify-between">
        <h2 className="text-lg font-bold">Your results</h2>
        <div className="text-right">
          <div className="tabular text-2xl font-bold text-navy">{eur(state.totalProfit)}</div>
          <div className="text-xs text-ink-3">
            total earned{state.rank ? ` · #${state.rank} of ${state.session.playingCount}` : ""}
          </div>
        </div>
      </div>
      <table className="tabular mt-3 w-full text-sm">
        <thead className="text-left text-xs text-ink-3">
          <tr>
            <th className="py-1 font-medium">Round</th>
            <th className="py-1 text-right font-medium">Your offer</th>
            <th className="py-1 text-right font-medium">Top bought</th>
            <th className="py-1 text-right font-medium">Sold</th>
            <th className="py-1 text-right font-medium">Earned</th>
          </tr>
        </thead>
        <tbody>
          {[...state.history].reverse().map((h) => (
            <tr key={h.roundId} className="border-t border-line">
              <td className="py-1.5">
                R{h.number} <span className="text-ink-3">{h.phase === "practice" ? "(practice)" : h.phase === "collusion" ? "🤝" : ""}</span>
              </td>
              <td className="py-1.5 text-right">{h.myPrice != null ? eur(h.myPrice) : "—"}</td>
              <td className="py-1.5 text-right">{eur(h.marginalPrice)}</td>
              <td className="py-1.5 text-right">{mw(h.dispatched)}</td>
              <td className="py-1.5 text-right font-semibold">{eur(h.profit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
