"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useSyncExternalStore } from "react";
import useSWR from "swr";
import { MeritOrderChart, PriceHistoryChart } from "@/components/charts";
import { eur, formatClock, mw, mwRange, useCountdown } from "@/components/client";
import { QR, useAppUrl } from "@/components/qr";
import { Presenter } from "@/components/presenter";
import { SummaryBody } from "@/components/summary";
import { Logo, PhaseBadge } from "@/components/ui";
import { api } from "@/lib/api";
import type { RoundView, ScreenSession, SessionView } from "@/lib/types";

// Projector view. It follows the game by itself: lobby → open round → results.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <ScreenOrPicker />
    </Suspense>
  );
}

/** /screen/?id=… shows a session; plain /screen/ lets the projector pick one. */
function ScreenOrPicker() {
  const id = useSearchParams().get("id");
  return id ? <Screen id={id} /> : <SessionPicker />;
}

function SessionPicker() {
  const { data, error } = useSWR<ScreenSession[]>("screen-sessions", api.screenSessions, { refreshInterval: 5000 });
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center gap-5">
        <Logo height={56} />
        <div>
          <h1 className="text-3xl font-bold text-navy">Projector screen</h1>
          <p className="text-ink-2">Choose the session to show. This list updates by itself.</p>
        </div>
      </header>
      {error && <p className="text-maroon">{error.message}</p>}
      {data?.length === 0 && (
        <p className="card p-6 text-center text-ink-2">No sessions yet. Create one in the instructor panel.</p>
      )}
      <ul className="flex flex-col gap-3">
        {data?.map((s) => (
          <li key={s.id}>
            <Link
              href={`/screen?id=${s.id}`}
              className="card flex items-center justify-between gap-4 p-5 transition-colors hover:border-navy"
            >
              <div>
                <div className="text-xl font-bold text-navy">{s.name}</div>
                <div className="text-sm text-ink-3">
                  {new Date(s.createdAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{" "}
                  · {s.teamsJoined} teams joined · {s.roundsPlayed} rounds played
                </div>
              </div>
              <span className="btn btn-primary shrink-0">Show ▸</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

/** The projector: live game and slides on one full screen (see components/presenter.tsx). */
function Screen({ id }: { id: string }) {
  return (
    <Presenter summary={<SummaryScreen id={id} />}>
      <GameScreen id={id} />
    </Presenter>
  );
}

function Header({ badge }: { badge?: React.ReactNode }) {
  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-6">
        <Logo height={56} />
        <div>
          <div className="text-3xl font-bold text-navy">The Electricity Market Game</div>
          <div className="text-lg text-ink-2">Run a power plant and sell your electricity.</div>
        </div>
      </div>
      {badge}
    </header>
  );
}

/** Summary of Part 1, then Part 1 vs Part 2 (components/summary.tsx). Shares the game's data. */
function SummaryScreen({ id }: { id: string }) {
  const { data } = useSWR<SessionView>(["screen", id], () => api.screen(id), { refreshInterval: 2000 });
  if (!data) return null;
  return (
    <Stage>
      <Header />
      <SummaryBody session={data} />
    </Stage>
  );
}

function GameScreen({ id }: { id: string }) {
  const { data, error } = useSWR<SessionView>(["screen", id], () => api.screen(id), {
    refreshInterval: 2000,
  });

  if (error) return <p className="p-10 text-center text-2xl text-maroon">{error.message}</p>;
  if (!data) return null;

  const open = data.rounds.find((r) => r.status === "open");
  const lastClosed = [...data.rounds].reverse().find((r) => r.status === "closed");

  return (
    <Stage>
      <Header badge={(open ?? lastClosed) && <PhaseBadge phase={(open ?? lastClosed)!.phase} large />} />
      {open ? <OpenRound session={data} round={open} /> : lastClosed ? <Results session={data} round={lastClosed} /> : <Lobby session={data} />}
    </Stage>
  );
}

// The screen is laid out on a fixed 1600×900 canvas and scaled to fit, so it
// looks the same on any projector resolution.
const STAGE_W = 1600;
const STAGE_H = 900;

function subscribeResize(cb: () => void) {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}

function Stage({ children }: { children: React.ReactNode }) {
  const size = useSyncExternalStore(
    subscribeResize,
    () => `${window.innerWidth}x${window.innerHeight}`,
    () => `${STAGE_W}x${STAGE_H}`,
  );
  const [w, h] = size.split("x").map(Number);
  const scale = Math.min(w / STAGE_W, h / STAGE_H);
  return (
    <div className="fixed inset-0 overflow-hidden bg-sand-light">
      <main
        className="absolute flex flex-col gap-5 px-10 py-6"
        style={{
          width: STAGE_W,
          height: STAGE_H,
          left: (w - STAGE_W * scale) / 2,
          top: (h - STAGE_H * scale) / 2,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </main>
    </div>
  );
}

function TeamTiles({
  groups,
  done,
  doneLabel = "✓ ready",
}: {
  groups: SessionView["groups"];
  done: (id: number) => boolean;
  doneLabel?: string;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
      {groups.map((g) => {
        const ok = done(g.id);
        return (
          <div
            key={g.id}
            className={`flex items-center gap-3 rounded-xl border-2 p-3 transition-colors ${ok ? "border-teal bg-white" : "border-dashed border-sand bg-white/50"}`}
          >
            <span className="text-3xl">{g.icon}</span>
            <div className="min-w-0">
              <div className="truncate text-lg font-bold">{g.displayName}</div>
              <div className={`text-sm ${ok ? "text-teal" : "text-ink-3"}`}>{ok ? doneLabel : "waiting…"}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Lobby({ session }: { session: SessionView }) {
  const home = useAppUrl("/");
  return (
    <div className="grid flex-1 grid-cols-[auto_1fr] items-start gap-12 pt-6">
      <div className="card flex flex-col items-center gap-3 p-8">
        {home && <QR text={home} size={300} />}
        <div className="text-center text-2xl text-ink-2">
          Go to <b className="text-navy">{home.replace(/^https?:\/\//, "").replace(/\/$/, "")}</b>
          <br />and enter your <b>team code</b>
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <h2 className="text-4xl font-bold">You run a power plant.</h2>
        <p className="max-w-3xl text-2xl text-ink-2">
          Each hour, every team offers its electricity at a price. The cheapest offers are bought until demand is covered,
          and each team that sells is paid the price it asked for. Ask too much, and you may sell nothing!
        </p>
        <TeamTiles
          groups={session.groups.filter((g) => g.active)}
          done={(gid) => session.groups.find((g) => g.id === gid)?.joined ?? false}
          doneLabel="✓ joined"
        />
      </div>
    </div>
  );
}

function OpenRound({ session, round }: { session: SessionView; round: RoundView }) {
  const left = useCountdown(round.deadline, session.serverTime);
  const hasHistory = session.rounds.some((r) => r.status === "closed");
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="grid grid-cols-3 items-center gap-6">
        <div>
          <div className="text-2xl text-ink-2">Round {round.number}</div>
          <div className="text-5xl font-bold">{round.label}</div>
        </div>
        <div className="card p-5 text-center">
          <div className="text-xl text-ink-2">{round.demandKnown ? "Demand this hour" : "🎲 Demand forecast"}</div>
          <div className={`tabular font-bold text-navy ${round.demandKnown ? "text-6xl" : "text-5xl"}`}>
            {round.demandKnown ? mw(round.demandMw) : mwRange(round.demandLow, round.demandHigh)}
          </div>
          <div className="text-lg text-ink-3">
            {round.demandKnown
              ? `room for ${(round.demandMw / (session.playingCapacity / Math.max(1, session.playingCount))).toLocaleString("en-GB", { maximumFractionDigits: 1 })} of ${session.playingCount} plants`
              : "the real value is revealed at the end"}
          </div>
        </div>
        {left != null ? (
          <div className={`tabular text-center text-9xl font-bold ${left <= 15 ? "text-orange" : "text-navy"}`}>
            {formatClock(left)}
          </div>
        ) : (
          <div className="text-center text-4xl font-bold text-navy">Send your offers!</div>
        )}
      </div>
      {round.phase === "collusion" && (
        <div className="rounded-xl bg-orange px-6 py-4 text-3xl font-bold text-white">
          🤝 You may now talk to other teams and agree on prices.
        </div>
      )}
      <TeamTiles groups={session.groups.filter((g) => g.playing)} done={(gid) => round.submittedGroupIds.includes(gid)} />
      {hasHistory && (
        <div className="card mt-auto p-4">
          <PriceHistoryChart
            rounds={session.rounds}
            priceCap={session.priceCap}
            height={220}
            large
          />
        </div>
      )}
    </div>
  );
}

function Results({ session, round }: { session: SessionView; round: RoundView }) {
  const name = new Map(session.groups.map((g) => [g.id, g]));
  const roundProfits = [...round.bids].sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0));
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1.6fr_1fr] gap-6">
      <div className="flex flex-col gap-5">
        <div className="card p-5">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-2xl font-bold">Round {round.number} · {round.label}</h2>
            <span className="text-xl text-ink-2">
              {round.demandSpread > 0 && "🎲 Real demand "}
              {round.demandSpread > 0 ? <b className="text-ink">{mw(round.demandMw)}</b> : `Demand ${mw(round.demandMw)}`}
              {round.demandSpread > 0 && ` (forecast ${mwRange(round.demandLow, round.demandHigh)})`}
            </span>
          </div>
          {round.phase !== "collusion" && (
            <p className="mb-2 text-sm text-ink-3">Companies are anonymous in Part 1 (A, B, C…): letters are reshuffled every round.</p>
          )}
          <MeritOrderChart
            bids={round.bids}
            groups={session.groups}
            demand={round.demandMw}
            clearingPrice={round.clearingPrice}
            priceCap={session.priceCap}
            height={330}
            large
          />
        </div>
        <div className="card p-5">
          <PriceHistoryChart
            rounds={session.rounds}
            priceCap={session.priceCap}
            height={200}
            large
          />
        </div>
      </div>
      <div className="flex flex-col gap-5">
        <div className="rounded-2xl bg-navy p-6 text-white">
          <div className="text-xl opacity-80">Average price paid</div>
          <div className="tabular text-7xl font-bold">{eur(round.clearingPrice ?? 0)}</div>
          <div className="text-xl opacity-80">
            per MWh · most expensive offer bought: {eur(round.marginalPrice ?? 0)}
          </div>
        </div>
        <div className="card p-5">
          <h3 className="mb-2 text-xl font-bold">This round</h3>
          <Ranking
            rows={roundProfits.slice(0, 5).map((b) => ({ id: b.groupId, profit: b.profit ?? 0, anon: b.anonLabel }))}
            name={name}
          />
        </div>
        <div className="card p-5">
          <h3 className="mb-2 text-xl font-bold">Total earned</h3>
          {session.rankingPublic ? (
            <Ranking rows={session.leaderboard.slice(0, 5).map((l) => ({ id: l.groupId, profit: l.profit }))} name={name} medals />
          ) : (
            <p className="text-xl text-ink-2">Each team can see its total and its position on its phone.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Ranking({
  rows,
  name,
  medals = false,
}: {
  rows: { id: number; profit: number; anon?: string | null }[];
  name: Map<number, SessionView["groups"][number]>;
  medals?: boolean;
}) {
  return (
    <ol className="tabular flex flex-col gap-1.5 text-xl">
      {rows.map((r, i) => {
        const g = name.get(r.id);
        return (
          <li key={r.id} className="flex items-center justify-between gap-3">
            <span className="truncate">
              <span className="inline-block w-8 text-ink-3">{medals && i < 3 && r.profit > 0 ? ["🥇", "🥈", "🥉"][i] : `${i + 1}.`}</span>
              {r.anon ? `Company ${r.anon}` : `${g?.icon} ${g?.displayName}`}
            </span>
            <span className={`font-bold ${r.profit < 0 ? "text-maroon" : ""}`}>{eur(r.profit)}</span>
          </li>
        );
      })}
    </ol>
  );
}
