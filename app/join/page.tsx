"use client";

// Where the projector's QR leads. The first phone of each group gets a team;
// teammates type that team's code instead. A phone that already has a team in
// this session goes straight back to it.

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Logo } from "@/components/ui";
import { api } from "@/lib/api";
import { rememberedTeam, rememberTeam } from "@/lib/team-memory";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Join />
    </Suspense>
  );
}

function Join() {
  const router = useRouter();
  const sessionId = useSearchParams().get("id") ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "");

  const goTo = (teamCode: string) => {
    rememberTeam(sessionId, teamCode);
    router.replace(`/g?code=${teamCode}`);
  };

  // This phone already has a team here: back to it (the server confirms the code).
  useEffect(() => {
    const known = rememberedTeam(sessionId);
    if (!sessionId || !known) return;
    api
      .joinSession(sessionId, known)
      .then((r) => {
        if (!r.new) goTo(r.code);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const getTeam = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api.joinSession(sessionId, rememberedTeam(sessionId));
      goTo(r.code);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not join");
      setBusy(false);
    }
  };

  if (!sessionId)
    return (
      <main className="mx-auto max-w-md px-5 py-16 text-center text-lg text-ink-2">
        Scan the QR code on the projector to join the game.
      </main>
    );

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-5 py-10">
      <div className="flex justify-center">
        <Logo height={64} />
      </div>
      <h1 className="text-center text-3xl font-bold text-navy">The Electricity Market Game</h1>

      <section className="card flex flex-col gap-3 p-5">
        <h2 className="text-lg font-bold">One phone per group</h2>
        <p className="text-ink-2">Your group gets its own power plant. Only one of you needs to tap this.</p>
        <button className="btn btn-accent py-3 text-lg" onClick={getTeam} disabled={busy}>
          {busy ? "Joining…" : "Get a team for my group"}
        </button>
        {error && <p className="text-sm text-maroon">{error}</p>}
      </section>

      <form
        className="card flex flex-col gap-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (clean.length >= 4) router.push(`/g?code=${clean}`);
        }}
      >
        <h2 className="text-lg font-bold">My group already has a team</h2>
        <p className="text-ink-2">Type the team code shown on your teammate&apos;s phone.</p>
        <input
          className="input text-center text-2xl font-bold uppercase tracking-[0.3em]"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="ABC12"
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={8}
        />
        <button className="btn btn-primary" disabled={clean.length < 4}>
          Join that team
        </button>
      </form>
    </main>
  );
}
