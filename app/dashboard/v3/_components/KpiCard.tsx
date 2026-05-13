import { cn } from "@/lib/cn";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

export interface KpiProps {
  label: string;
  value: string | number;
  sublabel?: string;
  delta?: { value: number; suffix?: string } | null;
  accent?: "primary" | "success" | "warning" | "destructive";
  icon?: React.ReactNode;
}

const ACCENT_BG: Record<NonNullable<KpiProps["accent"]>, string> = {
  primary: "bg-primary/15 text-primary",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
};

export function KpiCard({ label, value, sublabel, delta, accent = "primary", icon }: KpiProps) {
  const deltaTone =
    delta == null
      ? null
      : delta.value > 0
      ? "success"
      : delta.value < 0
      ? "destructive"
      : "muted";

  const DeltaIcon =
    delta == null
      ? null
      : delta.value > 0
      ? ArrowUpRight
      : delta.value < 0
      ? ArrowDownRight
      : Minus;

  return (
    <div className="relative rounded-xl border border-border bg-card p-5 overflow-hidden">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        {icon && (
          <div className={cn("rounded-lg p-2", ACCENT_BG[accent])}>{icon}</div>
        )}
      </div>
      <div className="mt-3 text-3xl font-semibold text-foreground tabular-nums" style={{ fontFamily: "var(--font-display)" }}>
        {value}
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        {delta && DeltaIcon && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-medium",
              deltaTone === "success" && "text-success",
              deltaTone === "destructive" && "text-destructive",
              deltaTone === "muted" && "text-muted-foreground"
            )}
          >
            <DeltaIcon className="size-3" />
            {delta.value > 0 ? "+" : ""}
            {delta.value}
            {delta.suffix ?? "%"}
          </span>
        )}
        {sublabel && <span className="text-muted-foreground">{sublabel}</span>}
      </div>
    </div>
  );
}
