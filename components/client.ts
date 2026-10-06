"use client";

import { useEffect, useRef, useState } from "react";

/** Seconds left until `deadline`, corrected for the clock difference with the server. */
export function useCountdown(deadline: string | null | undefined, serverTime: string | undefined) {
  const offset = useRef(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (serverTime) offset.current = new Date(serverTime).getTime() - Date.now();
  }, [serverTime]);

  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now() + offset.current), 250);
    return () => clearInterval(t);
  }, [deadline]);

  if (!deadline) return null;
  return Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000));
}

export function formatClock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export const eur = (v: number, digits = 0) =>
  `€${v.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export const mw = (v: number) => `${Math.round(v).toLocaleString("en-GB")} MW`;

/** "665–735 MW" for a forecast range, "700 MW" when the demand is exact. */
export const mwRange = (low: number, high: number) =>
  low === high ? mw(low) : `${Math.round(low).toLocaleString("en-GB")}–${mw(high)}`;

/** Width of an element, kept in sync with resizes, for charts drawn in real pixels. */
export function useWidth<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}
