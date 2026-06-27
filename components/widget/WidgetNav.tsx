"use client";

/**
 * WidgetNav — the integrated top tab bar for the embedded widget (matches the
 * approved Front/Linear sketch). Each tab links to its own /widget/<route>
 * page (GHL menu links are separate URLs) while preserving widget_token, so
 * the whole thing reads as one app instead of disconnected screens.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";

const TABS: { label: string; route: string }[] = [
  { label: "שיחות", route: "/widget/inbox" },
  { label: "הצעות", route: "/widget/factory-flow" },
  { label: "ניתוח", route: "/widget/analysis" },
  { label: "מחשבון", route: "/widget/calculator" },
  { label: "משלוחים", route: "/widget/shipping" },
  { label: "הגדרות", route: "/widget/settings" },
];

function NavInner() {
  const pathname = usePathname() || "";
  const params = useSearchParams();
  const token = params.get("widget_token") ?? "";
  const sid = params.get("sid");
  const qs = (route: string) => {
    const u = new URLSearchParams();
    if (token) u.set("widget_token", token);
    if (sid && route === "/widget/calculator") u.set("sid", sid);
    const s = u.toString();
    return s ? `${route}?${s}` : route;
  };

  return (
    <nav
      dir="rtl"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 12px",
        marginBottom: 12,
        borderRadius: 14,
        background: "rgba(255,255,255,0.045)",
        border: "1px solid rgba(255,255,255,0.10)",
        backdropFilter: "blur(30px) saturate(1.7)",
        WebkitBackdropFilter: "blur(30px) saturate(1.7)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12)",
        position: "sticky",
        top: 8,
        zIndex: 50,
      }}
    >
      {/* brand */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          paddingInlineStart: 4,
          paddingInlineEnd: 10,
          marginInlineEnd: 4,
          borderInlineEnd: "1px solid rgba(255,255,255,0.08)",
          fontWeight: 700,
          fontSize: 14,
          letterSpacing: "0.2px",
          color: "#fdf3e6",
          whiteSpace: "nowrap",
        }}
      >
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            background: "linear-gradient(135deg, #e7cba6, #cda978)",
            display: "inline-block",
          }}
        />
        אלבדי
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, overflowX: "auto" }}>
        {TABS.map((t) => {
          const active = pathname.startsWith(t.route);
          return (
            <Link
              key={t.route}
              href={qs(t.route)}
              style={{
                padding: "6px 14px",
                borderRadius: 9,
                fontSize: 13.5,
                fontWeight: active ? 600 : 500,
                whiteSpace: "nowrap",
                textDecoration: "none",
                transition: "background 0.12s ease, color 0.12s ease",
                background: active ? "rgba(205,169,120,0.16)" : "transparent",
                border: `1px solid ${active ? "rgba(205,169,120,0.34)" : "transparent"}`,
                color: active ? "#e7cba6" : "#9a9ea6",
              }}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function WidgetNav() {
  return (
    <Suspense fallback={<div style={{ height: 52, marginBottom: 12 }} />}>
      <NavInner />
    </Suspense>
  );
}
