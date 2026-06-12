"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  Calculator,
  Ruler,
} from "lucide-react";
import { cn } from "@/lib/cn";

const BOTTOM_NAV = [
  { href: "/dashboard/v3", label: "בקרה", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/v3/conversations", label: "שיחות", icon: MessageSquare },
  { href: "/dashboard/v3/sizes", label: "מידות", icon: Ruler },
  { href: "/dashboard/v3/calculator", label: "מחשבון", icon: Calculator },
  { href: "/dashboard/v3/leads", label: "לידים", icon: Users },
];

export function BottomNavBar() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-border bg-card/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {BOTTOM_NAV.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href);
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-col items-center gap-0.5 px-3 py-2 text-[10px] transition-colors min-w-0",
              active
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-5" />
            <span className="leading-tight">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
