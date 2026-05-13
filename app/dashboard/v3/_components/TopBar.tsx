"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const RANGES = [
  { key: "today", label: "היום" },
  { key: "week", label: "שבוע" },
  { key: "month", label: "חודש" },
  { key: "year", label: "שנה" },
] as const;

export type TimeRangeKey = (typeof RANGES)[number]["key"];

export function TopBar({
  title,
  description,
  currentRange,
  showRange = true,
  rightSlot,
}: {
  title: string;
  description?: string;
  currentRange: TimeRangeKey;
  showRange?: boolean;
  rightSlot?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const setRange = (next: TimeRangeKey) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("range", next);
    router.replace(`${pathname}?${sp.toString()}`);
  };

  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-border pb-6 mb-6">
      <div>
        <h1 className="text-3xl font-medium text-foreground" style={{ fontFamily: "var(--font-display)" }}>
          {title}
        </h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">{description}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        {showRange && (
          <div className="inline-flex items-center rounded-lg bg-secondary p-1 text-xs">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key)}
                className={cn(
                  "px-3 py-1.5 rounded-md transition-colors",
                  currentRange === r.key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
        {rightSlot}
      </div>
    </header>
  );
}
