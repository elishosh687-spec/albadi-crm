"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { NAV } from "./Sidebar";

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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "fixed right-3 top-3 z-40 grid size-10 place-items-center rounded-lg md:hidden",
          "border border-border bg-card/80 text-foreground backdrop-blur hover:bg-secondary"
        )}
        aria-label="פתח תפריט"
      >
        <Menu className="size-5" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex md:hidden"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            aria-label="סגור תפריט"
            className="flex-1 bg-black/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <aside
            className={cn(
              "flex w-64 max-w-[80vw] flex-col gap-1 overflow-y-auto border-l border-border bg-card p-4"
            )}
          >
            <div className="flex items-center justify-between pb-4">
              <div className="flex items-center gap-2">
                <div className="grid size-8 place-items-center rounded-lg bg-primary/20">
                  <span
                    className="text-lg font-bold text-primary"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    א
                  </span>
                </div>
                <div className="leading-tight">
                  <div className="font-semibold text-foreground">אלבדי</div>
                  <div className="text-xs text-muted-foreground">Supervisor</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
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
                      <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
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
