"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import useSWR from "swr";
import { MeritOrderChart, PriceHistoryChart } from "@/components/charts";
import { eur, formatClock, mw, mwRange, useCountdown } from "@/components/client";
import { Logo, PhaseBadge } from "@/components/ui";
import { PHASE_LABEL, type Phase } from "@/lib/game";

const PHASE_SHORT: Record<Phase, string> = { practice: "Practice", competition: "Part 1", collusion: "Part 2 🤝" };
import { api, ApiError } from "@/lib/api";
import { downloadCsv, EXPORTS } from "@/lib/exports";
import type { RoundView, SessionView } from "@/lib/types";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ControlPanel />
    </Suspense>
  );
}

function ControlPanel() {
  const id = useSearchParams().get("id") ?? "";
  const { data, error, mutate } = useSWR<SessionView>(id ? ["admin-session", id] : null, () => api.session(id), {
    refreshInterval: 2000,
  });
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<number | null>(null);

  const act = async (payload: Record<string, unknown>) => {
    setErr("");
    try {
      await mutate(await api.action(id, payload), false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action failed");
    }
  };

  if (error instanceof ApiError && error.status === 401)
    return <p className="p-10 text-center">Please <Link className="underline" href="/admin">log in</Link> first.</p>;
  if (error) return <p className="p-10 text-center text-maroon">{error.message}</p>;
  if (!data) return <p className="p-10 text-center text-ink-3">Loading…</p>;

  const open = data.rounds.find((r) => r.status === "open");
  const lastClosed = [...data.rounds].reverse().find((r) => r.status === "closed");
  const shown = data.rounds.find((r) => r.id === selected) ?? open ?? lastClosed;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-5 py-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/admin"><Logo height={40} /></Link>
          <div>
            <h1 className="text-xl font-bold text-navy">{data.name}</h1>
            <div className="text-sm text-ink-3">
              Pay-as-bid · {data.playingCount} of {data.groups.length} teams playing ·{" "}
              {mw(data.playingCapacity)} · cap{" "}
              {eur(data.priceCap)}/MWh
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="btn btn-primary" href={`/screen?id=${data.id}`} target="_blank">Projector screen ↗</Link>
          <Link className="btn btn-ghost" href={`/admin/cards?id=${data.id}`} target="_blank">Print team cards</Link>
          <ExportMenu id={data.id} />
        </div>
      </header>

      {err && (
        <div className="flex items-center justify-between rounded-lg bg-maroon/10 px-4 py-2 text-maroon">
          {err} <button onClick={() => setErr("")} aria-label="Dismiss">✕</button>
        </div>
      )}

      {open && <LiveRound session={data} round={open} act={act} />}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Rounds session={data} act={act} selected={shown?.id} onSelect={setSelected} />
        <Teams session={data} open={open} act={act} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="card p-4">
          <h2 className="mb-2 font-bold">
            {shown ? `Round ${shown.number} · ${shown.label}` : "Merit order"}
            {shown?.status === "open" && <span className="ml-2 text-sm font-normal text-orange">live offers</span>}
          </h2>
          {shown && shown.status !== "pending" ? (
            <MeritOrderChart
              bids={shown.bids}
              groups={data.groups}
              demand={shown.demandMw}
              clearingPrice={shown.clearingPrice}
              priceCap={data.priceCap}
              height={320}
            />
          ) : (
            <p className="text-ink-3">Open a round to see offers here.</p>
          )}
        </section>
        <section className="card p-4">
          <h2 className="mb-2 font-bold">Average price paid per round</h2>
          <PriceHistoryChart
            rounds={data.rounds}
            priceCap={data.priceCap}
            height={320}
          />
        </section>
      </div>

      <Settings session={data} act={act} />
    </main>
  );
}

type Act = (payload: Record<string, unknown>) => Promise<void>;

function LiveRound({ session, round, act }: { session: SessionView; round: RoundView; act: Act }) {
  const left = useCountdown(round.deadline, session.serverTime);
  const submitted = round.submittedGroupIds.length;
  return (
    <section className="card flex flex-wrap items-center justify-between gap-4 border-2 border-orange p-4">
      <div>
        <PhaseBadge phase={round.phase} />
        <div className="mt-1 text-lg font-bold">Round {round.number} · {round.label} is open</div>
        <div className="text-sm text-ink-2">
          Demand {mw(round.demandMw)}
          {round.demandSpread > 0 && ` · teams see ${mwRange(round.demandLow, round.demandHigh)}`}
        </div>
      </div>
      <div className="tabular text-center">
        <div className="text-3xl font-bold text-navy">{submitted}/{session.playingCount}</div>
        <div className="text-xs text-ink-3">offers in</div>
      </div>
      {left != null && (
        <div className={`tabular text-4xl font-bold ${left === 0 ? "text-maroon" : "text-navy"}`}>{formatClock(left)}</div>
      )}
      <div className="flex gap-2">
        <button className="btn btn-ghost" onClick={() => act({ action: "extendRound", roundId: round.id, seconds: 30 })} disabled={!round.deadline}>
          +30 s
        </button>
        <button className="btn btn-accent" onClick={() => act({ action: "closeRound", roundId: round.id })}>
          Close & clear market
        </button>
      </div>
    </section>
  );
}

function Rounds({
  session,
  act,
  selected,
  onSelect,
}: {
  session: SessionView;
  act: Act;
  selected?: number;
  onSelect: (id: number) => void;
}) {
  const hasOpen = session.rounds.some((r) => r.status === "open");
  const [draft, setDraft] = useState<{ label: string; phase: Phase; pct: number; spread: number }>({
    label: "",
    phase: "collusion",
    pct: 70,
    spread: 0,
  });

  return (
    <section className="card p-4">
      <h2 className="mb-2 font-bold">Rounds</h2>
      <div className="overflow-x-auto">
        <table className="tabular w-full text-sm">
          <thead className="text-left text-xs text-ink-3">
            <tr>
              <th className="py-1 font-medium">#</th>
              <th className="py-1 font-medium">Hour</th>
              <th className="py-1 font-medium">Phase</th>
              <th className="py-1 text-right font-medium" title="% of the capacity of the teams playing · ± uncertainty (teams see a range, the real value is drawn at random)">
                Demand · ±🎲
              </th>
              <th className="py-1 text-right font-medium">Avg · top</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {session.rounds.map((r) => (
              <tr
                key={r.id}
                className={`border-t border-line ${r.id === selected ? "bg-sky/40" : ""} ${r.status !== "pending" ? "cursor-pointer" : ""}`}
                onClick={() => r.status !== "pending" && onSelect(r.id)}
              >
                <td className="py-1.5 pr-2">{r.number}</td>
                <td className="py-1.5 pr-2">
                  {r.status === "pending" ? (
                    <input
                      className="w-32 rounded border border-transparent px-1 hover:border-sand"
                      defaultValue={r.label}
                      onBlur={(e) => e.target.value !== r.label && act({ action: "updateRound", roundId: r.id, label: e.target.value })}
                    />
                  ) : (
                    r.label
                  )}
                </td>
                <td className="py-1.5 pr-2">
                  {r.status === "pending" ? (
                    <select
                      className="rounded border border-sand bg-white px-1 py-0.5"
                      value={r.phase}
                      onChange={(e) => act({ action: "updateRound", roundId: r.id, phase: e.target.value })}
                    >
                      {(Object.keys(PHASE_SHORT) as Phase[]).map((p) => <option key={p} value={p}>{PHASE_SHORT[p]}</option>)}
                    </select>
                  ) : (
                    <PhaseBadge phase={r.phase} />
                  )}
                </td>
                <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                  {r.status === "pending" ? (
                    <>
                      <input
                        className="w-11 rounded border border-sand px-1 text-right"
                        type="number"
                        defaultValue={Math.round(r.demandShare * 100)}
                        onBlur={(e) => {
                          const v = Number(e.target.value) / 100;
                          if (v !== r.demandShare) act({ action: "updateRound", roundId: r.id, demandShare: v });
                        }}
                      />
                      % ±
                      <input
                        key={`${r.id}-${r.demandSpread}`}
                        className="ml-1 w-11 rounded border border-sand px-1 text-right"
                        type="number"
                        min={0}
                        max={50}
                        defaultValue={Math.round(r.demandSpread * 100)}
                        onBlur={(e) => {
                          const v = Number(e.target.value) / 100;
                          if (v !== r.demandSpread) act({ action: "updateRound", roundId: r.id, demandSpread: v });
                        }}
                      />
                      %
                      <div className="text-xs text-ink-3">
                        ≈ {mwRange(r.demandLow, r.demandHigh)}
                        {r.demandCapped && (
                          <span title="Capped so at least one plant is always left unsold" className="ml-1 text-orange">
                            · capped
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      {mw(r.demandMw)}
                      {r.demandSpread > 0 && (
                        <div className="text-xs text-ink-3" title="Range the teams saw">
                          🎲 {mwRange(r.demandLow, r.demandHigh)}
                        </div>
                      )}
                    </>
                  )}
                </td>
                <td className="py-1.5 pr-2 text-right font-semibold whitespace-nowrap">
                  {r.status === "closed" ? (
                    <span title="Average price paid · top offer bought">
                      {eur(r.clearingPrice ?? 0)}
                      <span className="font-normal text-ink-3"> · {eur(r.marginalPrice ?? 0)}</span>
                    </span>
                  ) : r.status === "open" ? (
                    <span className="text-orange">open</span>
                  ) : (
                    ""
                  )}
                </td>
                <td className="py-1.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  {r.status === "pending" && (
                    <>
                      <button className="btn btn-primary px-2.5 py-1 text-xs" disabled={hasOpen} onClick={() => act({ action: "openRound", roundId: r.id })}>
                        Open
                      </button>
                      <button
                        className="ml-1 px-1.5 text-ink-3 hover:text-maroon"
                        title="Delete round"
                        onClick={() => confirm(`Delete round ${r.number}?`) && act({ action: "deleteRound", roundId: r.id })}
                      >
                        ✕
                      </button>
                    </>
                  )}
                  {r.status === "closed" && (
                    <button
                      className="px-1.5 text-xs text-ink-3 underline hover:text-maroon"
                      onClick={() =>
                        confirm(`Reset round ${r.number}? Its offers and results are removed (the bid log keeps a copy).`) &&
                        act({ action: "resetRound", roundId: r.id })
                      }
                    >
                      reset
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          act({
            action: "addRound",
            label: draft.label || "Extra round",
            phase: draft.phase,
            demandShare: draft.pct / 100,
            demandSpread: draft.spread / 100,
          });
          setDraft({ ...draft, label: "" });
        }}
      >
        <input className="input w-40" placeholder="Hour, e.g. 18:00" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
        <select className="input w-auto" value={draft.phase} onChange={(e) => setDraft({ ...draft, phase: e.target.value as Phase })}>
          {(Object.keys(PHASE_LABEL) as Phase[]).map((p) => <option key={p} value={p}>{PHASE_LABEL[p]}</option>)}
        </select>
        <input className="input w-20" type="number" value={draft.pct} onChange={(e) => setDraft({ ...draft, pct: Number(e.target.value) })} />
        <span>% demand ±</span>
        <input className="input w-16" type="number" min={0} max={50} value={draft.spread} onChange={(e) => setDraft({ ...draft, spread: Number(e.target.value) })} />
        <span>% 🎲</span>
        <button className="btn btn-ghost">Add round</button>
      </form>
    </section>
  );
}

function Teams({ session, open, act }: { session: SessionView; open?: RoundView; act: Act }) {
  const profit = new Map(session.leaderboard.map((l) => [l.groupId, l.profit]));
  return (
    <section className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-bold">Teams</h2>
        <button className="btn btn-ghost px-2.5 py-1 text-sm" onClick={() => act({ action: "addGroup" })}>+ Add team</button>
      </div>
      <div className="overflow-x-auto">
        <table className="tabular w-full text-sm">
          <thead className="text-left text-xs text-ink-3">
            <tr>
              <th className="py-1 font-medium">Code</th>
              <th className="py-1 font-medium">Team</th>
              <th className="py-1 font-medium">Plant</th>
              {open && <th className="py-1 text-right font-medium">Offer</th>}
              <th className="py-1 text-right font-medium">Earned</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {session.groups.map((g) => {
              const bid = open?.bids.find((b) => b.groupId === g.id);
              return (
                <tr key={g.id} className={`border-t border-line ${g.active ? "" : "opacity-50"}`}>
                  <td className="py-1.5 pr-2 font-mono font-semibold whitespace-nowrap">
                    <span
                      title={!g.active ? "Paused" : g.joined ? "Joined" : "Not joined yet"}
                      className={!g.active ? "text-maroon" : g.joined ? "text-teal" : "text-ink-3"}
                    >
                      ●
                    </span>{" "}
                    {g.code}
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      className="w-24 rounded border border-transparent px-1 hover:border-sand"
                      defaultValue={g.name ?? ""}
                      placeholder={g.displayName}
                      onBlur={(e) => e.target.value !== (g.name ?? "") && act({ action: "renameGroup", groupId: g.id, name: e.target.value })}
                    />
                  </td>
                  <td className="max-w-36 truncate py-1.5 pr-2 whitespace-nowrap" title={g.technology}>
                    {g.icon} {g.technology}
                  </td>
                  {open && (
                    <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                      {bid ? <>{eur(bid.price)}{bid.revisions > 1 && <span className="text-ink-3"> ({bid.revisions}×)</span>}</> : <span className="text-ink-3">—</span>}
                    </td>
                  )}
                  <td className="py-1.5 pr-2 text-right font-semibold">{eur(profit.get(g.id) ?? 0)}</td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    {g.joined && (
                      <button
                        className="px-1.5 text-xs text-ink-3 underline hover:text-navy"
                        title={g.active ? "The team left: stop counting it and block its offers" : "Bring the team back"}
                        onClick={() => act({ action: "setActive", groupId: g.id, active: !g.active })}
                      >
                        {g.active ? "pause" : "resume"}
                      </button>
                    )}
                    <button
                      className="px-1.5 text-ink-3 hover:text-maroon"
                      title="Remove team (only before it bids)"
                      onClick={() => confirm(`Remove ${g.displayName} (${g.technology})?`) && act({ action: "removeGroup", groupId: g.id })}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-3">
        <span className="text-teal">●</span> joined (opened its page) · <span>●</span> card not used yet ·{" "}
        <span className="text-maroon">●</span> paused. Demand only counts joined teams (all of them while nobody has
        joined yet), so unused cards need no action. Earnings exclude the practice round.
      </p>
    </section>
  );
}

function ExportMenu({ id }: { id: string }) {
  const [busy, setBusy] = useState("");
  return (
    <details className="relative">
      <summary className="btn btn-ghost list-none">Download data ▾</summary>
      <div className="card absolute right-0 z-20 mt-1 flex w-56 flex-col p-1 shadow-lg">
        {Object.entries(EXPORTS).map(([file, { label }]) => (
          <button
            key={file}
            className="rounded-md px-3 py-2 text-left text-sm hover:bg-sand-light disabled:opacity-50"
            disabled={busy === file}
            onClick={async () => {
              setBusy(file);
              try {
                await downloadCsv(id, file);
              } catch (e) {
                alert(e instanceof Error ? e.message : "Download failed");
              } finally {
                setBusy("");
              }
            }}
          >
            {label} <span className="text-ink-3">.csv</span>
          </button>
        ))}
      </div>
    </details>
  );
}

/** One click to give every round not played yet the same demand uncertainty. */
function SpreadAll({ act }: { act: Act }) {
  const [pct, setPct] = useState(10);
  return (
    <div className="flex flex-col gap-1">
      <span>Demand uncertainty for all pending rounds</span>
      <div className="flex items-center gap-2">
        ±
        <input className="input w-20" type="number" min={0} max={50} value={pct} onChange={(e) => setPct(Number(e.target.value))} />%
        <button className="btn btn-ghost px-2.5 py-1.5" onClick={() => act({ action: "setSpreadAll", demandSpread: pct / 100 })}>
          Apply
        </button>
        <button className="btn btn-ghost px-2.5 py-1.5" onClick={() => act({ action: "setSpreadAll", demandSpread: 0 })}>
          Exact demand
        </button>
      </div>
    </div>
  );
}

function Settings({ session, act }: { session: SessionView; act: Act }) {
  return (
    <section className="card flex flex-wrap items-end gap-5 p-4 text-sm">
      <h2 className="w-full font-bold">Settings</h2>
      <label className="flex flex-col gap-1">
        Price cap (€/MWh)
        <input
          className="input w-28"
          type="number"
          defaultValue={session.priceCap}
          onBlur={(e) => Number(e.target.value) !== session.priceCap && act({ action: "updateSession", priceCap: Number(e.target.value) })}
        />
      </label>
      <label className="flex flex-col gap-1">
        Seconds per round (0 = no timer)
        <input
          className="input w-28"
          type="number"
          defaultValue={session.roundSeconds}
          onBlur={(e) => Number(e.target.value) !== session.roundSeconds && act({ action: "updateSession", roundSeconds: Number(e.target.value) })}
        />
      </label>
      <SpreadAll act={act} />
    </section>
  );
}
