"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { NAV } from "./Sidebar";

/**
 * Mobile-only hamburger menu. Hidden at md+ (where the regular Sidebar shows).
 * Shows a slide-in drawer with the same nav items + active-badge counts.
 *
 * Does NOT touch the desktop Sidebar — drawer is a separate layer rendered
 * inside the dashboard layout, only visible below 768px.
 */
export function MobileMenu({
  pendingDrafts = 0,
  factoryReceived = 0,
}: {
  pendingDrafts?: number;
  factoryReceived?: number;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Hamburger trigger — appears in the top-right of the main area on mobile */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "md:hidden fixed top-3 right-3 z-40 size-10 rounded-lg",
          "bg-card/80 backdrop-blur border border-border",
          "grid place-items-center text-foreground hover:bg-secondary"
        )}
        aria-label="פתח תפריט"
      >
        <Menu className="size-5" />
      </button>

      {/* Backdrop + drawer */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-50 flex"
          role="dialog"
          aria-modal="true"
        >
          {/* Click-outside backdrop */}
          <button
            type="button"
            aria-label="סגור תפריט"
            className="flex-1 bg-black/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          {/* Drawer */}
          <aside
            className={cn(
              "w-64 max-w-[80vw] bg-card border-l border-border",
              "flex flex-col p-4 gap-1 overflow-y-auto"
            )}
          >
            <div className="flex items-center justify-between pb-4">
              <div className="flex items-center gap-2">
                <div className="size-8 rounded-lg bg-primary/20 grid place-items-center">
                  <span
                    className="text-primary font-bold text-lg"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    א
                  </span>
                </div>
                <div className="leading-tight">
                  <div className="font-semibold text-foreground">אלבד</div>
                  <div className="text-xs text-muted-foreground">Supervisor</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="size-8 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary"
                aria-label="סגור"
              >
                <X className="size-4" />
              </button>
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
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors",
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
          </aside>
        </div>
      )}
    </>
  );
}
