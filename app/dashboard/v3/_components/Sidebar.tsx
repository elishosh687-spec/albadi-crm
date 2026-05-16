"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Inbox,
  Users,
  KanbanSquare,
  BarChart3,
  MessageSquare,
  Settings,
  Factory,
} from "lucide-react";
import { cn } from "@/lib/cn";

export const NAV = [
  { href: "/dashboard/v3", label: "סקירה", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/v3/drafts", label: "תור אישורים", icon: Inbox },
  { href: "/dashboard/v3/leads", label: "לידים", icon: Users },
  { href: "/dashboard/v3/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/dashboard/v3/analytics", label: "אנליטיקה", icon: BarChart3 },
  { href: "/dashboard/v3/conversations", label: "שיחות", icon: MessageSquare },
  { href: "/dashboard/v3/factory", label: "הצעות מפעל", icon: Factory },
  { href: "/dashboard/v3/settings", label: "הגדרות", icon: Settings },
];

export function Sidebar({
  pendingDrafts = 0,
  factoryReceived = 0,
}: {
  pendingDrafts?: number;
  factoryReceived?: number;
}) {
  const pathname = usePathname();
  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col border-l border-border bg-card/60 backdrop-blur p-4 gap-1">
      <div className="px-2 pb-4 flex items-center gap-2">
        <div className="size-8 rounded-lg bg-primary/20 grid place-items-center">
          <span className="text-primary font-bold text-lg" style={{ fontFamily: "var(--font-display)" }}>
            א
          </span>
        </div>
        <div className="leading-tight">
          <div className="font-semibold text-foreground">אלבד</div>
          <div className="text-xs text-muted-foreground">Supervisor</div>
        </div>
      </div>
      <nav className="flex flex-col gap-1">
        {NAV.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          const Icon = item.icon;
          const badge =
            item.href === "/dashboard/v3/drafts" && pendingDrafts > 0
              ? pendingDrafts
              : item.href === "/dashboard/v3/factory" && factoryReceived > 0
                ? factoryReceived
                : null;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="flex-1 text-right">{item.label}</span>
              {badge !== null && (
                <span className="rounded-full bg-primary text-primary-foreground text-xs px-2 py-0.5 font-medium">
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto pt-4 px-2 text-xs text-muted-foreground border-t border-border/60">
        <div>v3 · {new Date().getFullYear()}</div>
      </div>
    </aside>
  );
}
