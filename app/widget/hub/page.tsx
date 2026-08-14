/**
 * Hub widget — unified entry point for all sub-widgets.
 *
 * Single GHL Custom Menu Link points here. Tabs swap which sub-widget
 * iframe renders below: inbox / playground / quotes / deals / analysis /
 * calculator / ads / competitors / 3D / shipping / settings.
 *
 * URL template:
 *   https://<host>/widget/hub?widget_token=<T>&tab=<tab>
 */

import Link from "next/link";
import type { CSSProperties } from "react";
import {
  MessagesSquare,
  Receipt,
  BarChart3,
  Megaphone,
  Calculator,
  Swords,
  Box,
  Package,
  Settings,
  Search,
  CircleCheckBig,
  FlaskConical,
  type LucideIcon,
} from "lucide-react";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";

export const dynamic = "force-dynamic";

interface SearchParams {
  widget_token?: string;
  tab?: string;
  sid?: string;
}

interface TabDef {
  id: string;
  label: string;
  icon: LucideIcon;
  url: (token: string, sid: string) => string;
}

function withSid(base: string, sid: string): string {
  return sid ? `${base}&sid=${encodeURIComponent(sid)}` : base;
}

const TABS: TabDef[] = [
  {
    id: "inbox",
    label: "שיחות",
    icon: MessagesSquare,
    url: (t, sid) => withSid(`/widget/inbox?widget_token=${encodeURIComponent(t)}`, sid),
  },
  {
    id: "playground",
    label: "מגרש בדיקות",
    icon: FlaskConical,
    url: (t) => `/widget/playground?widget_token=${encodeURIComponent(t)}`,
  },
  {
    id: "factory",
    label: "הצעות מחיר",
    icon: Receipt,
    url: (t, sid) => withSid(`/widget/factory-flow?widget_token=${encodeURIComponent(t)}`, sid),
  },
  {
    id: "closed",
    label: "עסקאות",
    icon: CircleCheckBig,
    url: (t) => `/widget/closed-quotes?widget_token=${encodeURIComponent(t)}`,
  },
  {
    id: "analysis",
    label: "ניתוח",
    icon: BarChart3,
    url: (t) => `/widget/analysis?widget_token=${encodeURIComponent(t)}`,
  },
  {
    id: "calc",
    label: "מחשבון",
    icon: Calculator,
    url: (t, sid) => withSid(`/widget/calculator?widget_token=${encodeURIComponent(t)}`, sid),
  },
  {
    id: "ads",
    label: "מודעות",
    icon: Megaphone,
    url: (t) => `/widget/ads?widget_token=${encodeURIComponent(t)}`,
  },
  {
    id: "competitors",
    label: "מחיר מתחרים",
    icon: Swords,
    url: (t, sid) => withSid(`/widget/competitors?widget_token=${encodeURIComponent(t)}`, sid),
  },
  {
    id: "designer",
    label: "מעצב 3D",
    icon: Box,
    url: (t) => `/configurator?widget_token=${encodeURIComponent(t)}`,
  },
  {
    id: "shipping",
    label: "צירוף משלוחים",
    icon: Package,
    url: (t) => `/widget/shipping?widget_token=${encodeURIComponent(t)}`,
  },
  {
    id: "settings",
    label: "הגדרות",
    icon: Settings,
    url: (t) => `/widget/settings?widget_token=${encodeURIComponent(t)}`,
  },
];

export default async function HubWidgetPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const token = params.widget_token ?? "";
  const sid = params.sid?.trim() ?? "";
  const activeId = TABS.find((t) => t.id === params.tab)?.id ?? "inbox";

  if (!verifyWidgetToken(token)) {
    return (
      <div style={{ padding: 24, color: "#f87171" }}>
        <h2 style={{ marginTop: 0 }}>אין הרשאה</h2>
        <p>חסר / לא תקין <code>widget_token</code>.</p>
      </div>
    );
  }

  const active = TABS.find((t) => t.id === activeId)!;

  return (
    <div
      className="lux-theme"
      dir="rtl"
      style={{
        display: "flex",
        flexDirection: "column",
        // dvh, not vh: on mobile Safari 100vh includes the collapsing toolbar,
        // so the shell is taller than the visible viewport and the sticky nav
        // scrolls away with no way back. Identical to vh on desktop.
        height: "100dvh",
        // Cancel the widget layout's padding exactly. It is fluid now, so this
        // must be the same expression negated — a hardcoded -12px left the page
        // 4px wider than the viewport on a phone and scrolled sideways.
        margin: "calc(-1 * clamp(6px, 2vw, 12px))",
        // keep a tab's inner scroller from rubber-banding the shell behind it
        overscrollBehavior: "contain",
        background: "#0d0c0b",
      }}
    >
      <nav
        className="hub-nav"
        style={{
          display: "flex",
          flexWrap: "nowrap",
          alignItems: "center",
          gap: 4,
          // fluid: unchanged 8/14px on desktop, tighter on a phone where every
          // pixel of the nav is width the tabs don't get
          padding: "8px clamp(8px, 3vw, 14px)",
          background: "rgba(255,255,255,0.045)",
          borderBottom: "1px solid rgba(230,225,224,0.08)",
          backdropFilter: "blur(30px) saturate(1.4)",
          WebkitBackdropFilter: "blur(30px) saturate(1.4)",
          boxShadow: "inset 0 1px 0 rgba(230,225,224,0.06)",
          position: "sticky",
          top: 0,
          zIndex: 10,
          overflowX: "auto",
          overflowY: "hidden",
          scrollbarWidth: "none",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {/* brand */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            paddingInlineEnd: 12,
            marginInlineEnd: 4,
            borderInlineEnd: "1px solid rgba(230,225,224,0.10)",
            fontWeight: 600,
            fontSize: 15,
            letterSpacing: "-0.01em",
            color: "#e6e1e0",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: 20,
              height: 20,
              borderRadius: 6,
              background: "linear-gradient(135deg, #e7cba6, #cda978)",
              display: "inline-block",
              flexShrink: 0,
            }}
          />
          אלבדי
        </div>

        {TABS.map((t) => {
          const isActive = t.id === activeId;
          const sidSuffix = sid ? `&sid=${encodeURIComponent(sid)}` : "";
          const href = `/widget/hub?widget_token=${encodeURIComponent(token)}&tab=${t.id}${sidSuffix}`;
          const Icon = t.icon;
          const style: CSSProperties = {
            gap: 6,
            padding: "0 11px",
            scrollSnapAlign: "center",
            fontSize: 13,
            fontWeight: isActive ? 600 : 500,
            height: 32,
            display: "flex",
            alignItems: "center",
            background: isActive ? "rgba(214,196,172,0.14)" : "transparent",
            color: isActive ? "#e6e1e0" : "#8a7f74",
            border: `1px solid ${isActive ? "rgba(214,196,172,0.30)" : "transparent"}`,
            borderRadius: 7,
            textDecoration: "none",
            whiteSpace: "nowrap",
            touchAction: "manipulation",
            flexShrink: 0,
          };
          return (
            <Link
              key={t.id}
              href={href}
              style={style}
              data-active={isActive ? "1" : undefined}
            >
              <Icon size={15} strokeWidth={1.75} style={{ flexShrink: 0 }} />
              {t.label}
            </Link>
          );
        })}

        {/* search affordance — visual only this phase. Hidden on a phone: it is
            aria-hidden and non-functional, so it is pure width tax there. */}
        <div
          aria-hidden
          className="hub-search"
          style={{
            marginInlineStart: "auto",
            display: "flex",
            alignItems: "center",
            gap: 7,
            height: 32,
            padding: "0 10px",
            borderRadius: 6,
            border: "1px solid rgba(230,225,224,0.08)",
            color: "#8a7f74",
            fontSize: 12.5,
            whiteSpace: "nowrap",
            flexShrink: 0,
            userSelect: "none",
          }}
        >
          <Search size={14} strokeWidth={1.75} style={{ flexShrink: 0 }} />
          חיפוש
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 1,
              padding: "1px 5px",
              borderRadius: 4,
              border: "1px solid rgba(230,225,224,0.08)",
              background: "rgba(230,225,224,0.03)",
              color: "#8a7f74",
              fontSize: 11,
            }}
          >
            ⌘K
          </span>
        </div>
      </nav>

      {/* Only 3 of 11 tabs fit on a phone, so on load the active one may be
          off-screen with nothing indicating the strip scrolls. This keeps the
          hub a server component — no "use client", no hydration — and is a
          no-op when the tab is already visible. */}
      <script
        dangerouslySetInnerHTML={{
          __html:
            "document.querySelector('.hub-nav [data-active]')" +
            "?.scrollIntoView({block:'nearest',inline:'center'});",
        }}
      />

      <iframe
        key={`${active.id}-${sid}`}
        src={active.url(token, sid)}
        style={{
          flex: 1,
          width: "100%",
          border: "none",
          background: "#1d1b1a",
        }}
        allow="clipboard-write"
      />
    </div>
  );
}
