"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import useSWR from "swr";
import { mw } from "@/components/client";
import { QR, useAppUrl } from "@/components/qr";
import { Logo } from "@/components/ui";
import { api } from "@/lib/api";
import type { SessionView } from "@/lib/types";

// One card per team, printed and handed out: plant, private cost and a QR to the team page.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <Cards />
    </Suspense>
  );
}

function Cards() {
  const id = useSearchParams().get("id") ?? "";
  const { data, error } = useSWR<SessionView>(id ? ["admin-session", id] : null, () => api.session(id));
  const home = useAppUrl("/");

  if (error) return <p className="p-10 text-center text-maroon">{error.message}</p>;
  if (!data || !home) return <p className="p-10 text-center text-ink-3">Loading…</p>;

  return (
    <main className="mx-auto w-full max-w-4xl p-6 print:p-0">
      <div className="no-print mb-4 flex items-center justify-between">
        <p className="text-ink-2">{data.groups.length} cards. Cut along the lines and give one to each team.</p>
        <button className="btn btn-primary" onClick={() => window.print()}>Print</button>
      </div>
      <div className="grid grid-cols-2 gap-0">
        {data.groups.map((g) => (
          <article key={g.id} className="flex break-inside-avoid flex-col gap-3 border border-dashed border-sand bg-white p-5">
            <div className="flex items-center justify-between">
              <Logo height={30} />
              <span className="text-sm font-semibold text-ink-3">Team {g.slot}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-4xl">{g.icon}</span>
              <div>
                <div className="text-xs uppercase tracking-wide text-ink-3">Your power plant</div>
                <div className="text-xl font-bold text-navy">{g.technology}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-sand-light p-3">
              <div>
                <div className="text-xs text-ink-3">You are paid</div>
                <div className="text-lg font-bold">the price you ask</div>
              </div>
              <div>
                <div className="text-xs text-ink-3">Capacity</div>
                <div className="tabular text-lg font-bold">{mw(g.capacity)}</div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <QR text={`${home}g/?code=${g.code}`} size={110} />
              <div>
                <div className="text-xs text-ink-3">Scan, or go to {home.replace(/^https?:\/\//, "").replace(/\/$/, "")} and enter</div>
                <div className="font-mono text-3xl font-bold tracking-[0.2em] text-navy">{g.code}</div>
                <div className="mt-1 text-xs text-ink-2">
                  Keep your strategy secret from other teams!
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
