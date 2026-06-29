/**
 * LuxStat — the small "number over caption" tile used in tab headers and rails
 * (e.g. "3 / באיחור", "12 / פעילים"). Presentation-only.
 */

import type { CSSProperties, ReactNode } from "react";

export interface LuxStatProps {
  value: ReactNode;
  label: ReactNode;
  /** tone of the number — alert (red) for overdue, default warm ink */
  tone?: "default" | "alert" | "champagne" | "success";
  style?: CSSProperties;
}

const NUM_COLOR: Record<NonNullable<LuxStatProps["tone"]>, string> = {
  default: "var(--lux-ink)",
  alert: "#e8b4b4",
  champagne: "var(--lux-champagne)",
  success: "var(--lux-success, #a8c0a0)",
};

const RING: Record<NonNullable<LuxStatProps["tone"]>, string> = {
  default: "rgba(69,70,77,0.16)",
  alert: "rgba(232,180,180,0.18)",
  champagne: "rgba(214,196,172,0.2)",
  success: "rgba(168,192,160,0.2)",
};

export default function LuxStat({
  value,
  label,
  tone = "default",
  style,
}: LuxStatProps) {
  return (
    <div
      className="lux-stat"
      style={{ boxShadow: `inset 0 0 0 1px ${RING[tone]}`, ...style }}
    >
      <div className="lux-stat-num" style={{ color: NUM_COLOR[tone] }}>
        {value}
      </div>
      <div className="lux-stat-label">{label}</div>
    </div>
  );
}
