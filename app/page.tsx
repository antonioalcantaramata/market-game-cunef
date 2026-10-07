"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/ui";

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "");

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-5 py-10">
      <div className="flex justify-center">
        <Logo height={72} />
      </div>
      <div className="text-center">
        <h1 className="text-3xl font-bold text-navy">The Electricity Market Game</h1>
        <p className="mt-2 text-ink-2">Run a power plant and sell your electricity.</p>
      </div>
      <form
        className="card flex flex-col gap-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (clean) router.push(`/g?code=${clean}`);
        }}
      >
        <label htmlFor="code" className="font-semibold">Your team code</label>
        <input
          id="code"
          className="input text-center text-2xl font-bold uppercase tracking-[0.3em]"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="ABC12"
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={8}
        />
        <button className="btn btn-accent py-3 text-lg" disabled={clean.length < 4}>
          Enter the market
        </button>
        <p className="text-center text-sm text-ink-3">
          New here? Scan the QR code on the projector. Already in a group? Type the code on your teammate&apos;s phone.
        </p>
      </form>
      <nav className="flex justify-center gap-6 text-sm text-ink-3">
        <Link href="/admin" className="underline underline-offset-2 hover:text-navy">Instructor panel</Link>
        <Link href="/screen" className="underline underline-offset-2 hover:text-navy">Projector screen</Link>
      </nav>
    </main>
  );
}
