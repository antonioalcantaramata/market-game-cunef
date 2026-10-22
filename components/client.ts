"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const onlineEvents = (notify: () => void) => {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
};

/** False while the device says it has no network (refreshes pause until it is back). */
export function useOnline() {
  return useSyncExternalStore(onlineEvents, () => navigator.onLine, () => true);
}

/** Seconds left until `deadline`, corrected for the clock difference with the server. */
export function useCountdown(deadline: string | null | undefined, serverTime: string | undefined) {
  // A reply that arrived late makes the server look behind by the delay, so keep
  // the largest difference seen: the one measured over the fastest reply.
  const offset = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!serverTime) return;
    const sample = new Date(serverTime).getTime() - Date.now();
    offset.current = offset.current == null ? sample : Math.max(offset.current, sample);
  }, [serverTime]);

  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now() + (offset.current ?? 0)), 250);
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

/** Height of an element, kept in sync with resizes (to fit a chart into the space left). */
export function useHeight<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, height] as const;
}

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
