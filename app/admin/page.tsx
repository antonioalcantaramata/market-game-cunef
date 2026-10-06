"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { api, ApiError } from "@/lib/api";
import { Logo } from "@/components/ui";
import type { SessionSummary } from "@/lib/types";

export default function AdminHome() {
  const { data, error, mutate } = useSWR<SessionSummary[]>("admin-sessions", api.sessions);
  const needsLogin = error instanceof ApiError && error.status === 401;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-8">
      <header className="flex items-center justify-between">
        <Logo height={44} />
        <span className="font-semibold text-navy">Instructor panel</span>
      </header>
      {needsLogin ? <Login onDone={() => mutate()} /> : (
        <>
          <CreateSession />
          <section className="card p-5">
            <h2 className="text-lg font-bold">Sessions</h2>
            {!data && !error && <p className="mt-2 text-ink-3">Loading…</p>}
            {error && !needsLogin && <p className="mt-2 text-maroon">{error.message}</p>}
            {data?.length === 0 && <p className="mt-2 text-ink-3">No sessions yet. Create one above.</p>}
            <ul className="mt-2 divide-y divide-line">
              {data?.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-3">
                  <div>
                    <Link href={`/admin/session?id=${s.id}`} className="font-semibold text-navy hover:underline">{s.name}</Link>
                    <div className="text-sm text-ink-3">
                      {new Date(s.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} ·{" "}
                      {s.groupCount} teams · {s.closedRounds} rounds played
                    </div>
                  </div>
                  <Link href={`/admin/session?id=${s.id}`} className="btn btn-ghost">Open</Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  return (
    <form
      className="card mx-auto flex w-full max-w-sm flex-col gap-3 p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api.login(password);
          onDone();
        } catch (e) {
          setErr(e instanceof Error ? e.message : "Login failed");
        }
      }}
    >
      <label htmlFor="pw" className="font-semibold">Instructor password</label>
      <input id="pw" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      <button className="btn btn-primary">Log in</button>
      {err && <p className="text-sm text-maroon">{err}</p>}
    </form>
  );
}

function CreateSession() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "Open Day · 24 Oct",
    groups: 10,
    priceCap: 200,
    roundSeconds: 180,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: k === "name" ? e.target.value : Number(e.target.value) });

  return (
    <form
      className="card grid grid-cols-2 gap-4 p-5 sm:grid-cols-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const { id } = await api.createSession(form);
          router.push(`/admin/session?id=${id}`);
        } catch (e) {
          setErr(e instanceof Error ? e.message : "Could not create the session");
          setBusy(false);
        }
      }}
    >
      <h2 className="col-span-full text-lg font-bold">New session</h2>
      <label className="col-span-full flex flex-col gap-1 text-sm sm:col-span-2">
        Name
        <input className="input" value={form.name} onChange={set("name")} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Teams
        <input className="input" type="number" min={1} max={40} value={form.groups} onChange={set("groups")} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Price cap (€/MWh)
        <input className="input" type="number" min={10} value={form.priceCap} onChange={set("priceCap")} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Seconds per round
        <input className="input" type="number" min={0} value={form.roundSeconds} onChange={set("roundSeconds")} />
      </label>
      <div className="col-span-full flex items-center justify-between gap-3 sm:col-span-3">
        <p className="text-xs text-ink-3">
          You can add or remove teams later, until they start bidding. The default plan has 1 practice round, 4 competition rounds and 4 rounds with agreements allowed.
        </p>
        <button className="btn btn-accent shrink-0" disabled={busy}>Create</button>
      </div>
      {err && <p className="col-span-full text-sm text-maroon">{err}</p>}
    </form>
  );
}
