/**
 * Hub widget — unified entry point for all sub-widgets.
 *
 * Single GHL Custom Menu Link points here. Tabs swap which sub-widget
 * iframe renders below: inbox / bot / factory / calculator / order /
 * settings.
 *
 * URL template:
 *   https://<host>/widget/hub?widget_token=<T>&tab=<tab>
 */

import Link from "next/link";
import type { CSSProperties } from "react";
import {
  MessagesSquare,
  Bot,
  Receipt,
  BarChart3,
  Calculator,
  Swords,
  Box,
  Package,
  Settings,
  Search,
  CircleCheckBig,
  Wand2,
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
  /** When set, the nav item opens this URL in a NEW TAB instead of swapping the
   *  hub iframe. Used for the local Bag Studio (localhost, Eli's Mac only) — it
   *  gets the widget token + current lead sid so it works without env setup. */
  external?: (token: string, sid: string) => string;
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
    id: "bot",
    label: "בוט",
    icon: Bot,
    url: (t, sid) => withSid(`/widget/bot-decisions?widget_token=${encodeURIComponent(t)}`, sid),
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
    id: "studio",
    label: "סטודיו",
    icon: Wand2,
    url: () => "",
    // Local Bag Studio — runs on Eli's Mac (needs the skills + keys). Opens in a
    // new tab, carrying the widget token + current lead sid so it can pull/send
    // without env setup. Only reachable while `npm start` is running in studio/.
    external: (t, sid) =>
      `http://localhost:4747/?token=${encodeURIComponent(t)}${sid ? `&sid=${encodeURIComponent(sid)}` : ""}`,
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
        height: "100vh",
        margin: "-12px",
        background: "#0d0c0b",
      }}
    >
      <nav
        style={{
          display: "flex",
          flexWrap: "nowrap",
          alignItems: "center",
          gap: 4,
          padding: "8px 14px",
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
          // External (local studio) opens a new tab; regular tabs swap the iframe.
          if (t.external) {
            return (
              <a
                key={t.id}
                href={t.external(token, sid)}
                target="_blank"
                rel="noopener noreferrer"
                title="נפתח בטאב חדש — רץ מקומית על ה-Mac (studio: npm start)"
                style={style}
              >
                <Icon size={15} strokeWidth={1.75} style={{ flexShrink: 0 }} />
                {t.label}
              </a>
            );
          }
          return (
            <Link key={t.id} href={href} style={style}>
              <Icon size={15} strokeWidth={1.75} style={{ flexShrink: 0 }} />
              {t.label}
            </Link>
          );
        })}

        {/* search affordance — visual only this phase */}
        <div
          aria-hidden
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
