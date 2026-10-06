import { BASE_PATH } from "@/lib/api";
import type { Phase } from "@/lib/game";
import { PHASE_LABEL } from "@/lib/game";

export function Logo({ height = 36 }: { height?: number }) {
  // The PNG carries its own clear space, so it is rendered as-is (no cropping).
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`${BASE_PATH}/cunef-logo.png`} alt="CUNEF Universidad" width={Math.round((height * 1906) / 1037)} height={height} />
  );
}

export const PHASE_COLOR: Record<Phase, string> = {
  practice: "#8a8780",
  competition: "var(--navy)",
  collusion: "var(--orange)",
};

export function PhaseBadge({ phase, large = false }: { phase: Phase; large?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold text-white ${
        large ? "px-4 py-1.5 text-lg" : "px-2.5 py-0.5 text-xs"
      }`}
      style={{ background: PHASE_COLOR[phase] }}
    >
      {PHASE_LABEL[phase]}
    </span>
  );
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</div>
      <div className="tabular text-2xl font-bold text-ink">{value}</div>
      {sub && <div className="text-xs text-ink-2">{sub}</div>}
    </div>
  );
}
