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
  url: (token: string, sid: string) => string;
}

function withSid(base: string, sid: string): string {
  return sid ? `${base}&sid=${encodeURIComponent(sid)}` : base;
}

const TABS: TabDef[] = [
  {
    id: "inbox",
    label: "📥 שיחות",
    url: (t, sid) => withSid(`/widget/inbox?widget_token=${encodeURIComponent(t)}`, sid),
  },
  {
    id: "bot",
    label: "🤖 בוט",
    url: (t, sid) => withSid(`/widget/bot-decisions?widget_token=${encodeURIComponent(t)}`, sid),
  },
  {
    id: "factory",
    label: "💰 הצעות מחיר",
    url: (t, sid) => withSid(`/widget/factory-flow?widget_token=${encodeURIComponent(t)}`, sid),
  },
  {
    id: "analysis",
    label: "🔍 ניתוח",
    url: (t) => `/widget/analysis?widget_token=${encodeURIComponent(t)}`,
  },
  {
    id: "calc",
    label: "🧮 מחשבון",
    url: (t, sid) => withSid(`/widget/calculator?widget_token=${encodeURIComponent(t)}`, sid),
  },
  {
    id: "designer",
    label: "🎨 מעצב 3D",
    url: (t) => `/configurator?widget_token=${encodeURIComponent(t)}`,
  },
  {
    id: "shipping",
    label: "📦 צירוף משלוחים",
    url: (t) => `/widget/shipping?widget_token=${encodeURIComponent(t)}`,
  },
  {
    id: "settings",
    label: "⚙️ הגדרות",
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
      className="gg-theme"
      dir="rtl"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        margin: "-12px",
        background: "#050506",
      }}
    >
      <nav
        style={{
          display: "flex",
          flexWrap: "nowrap",
          alignItems: "center",
          gap: 4,
          padding: "10px 14px",
          background: "rgba(255,255,255,0.045)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          backdropFilter: "blur(30px) saturate(1.7)",
          WebkitBackdropFilter: "blur(30px) saturate(1.7)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12)",
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
            gap: 7,
            paddingInlineEnd: 12,
            marginInlineEnd: 4,
            borderInlineEnd: "1px solid rgba(255,255,255,0.10)",
            fontWeight: 700,
            fontSize: 15,
            color: "#fdf3e6",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: 7,
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
          return (
            <Link
              key={t.id}
              href={href}
              style={{
                padding: "8px 14px",
                fontSize: 13.5,
                fontWeight: isActive ? 600 : 500,
                minHeight: 38,
                display: "flex",
                alignItems: "center",
                background: isActive ? "rgba(205,169,120,0.16)" : "transparent",
                color: isActive ? "#e7cba6" : "#9a9ea6",
                border: `1px solid ${isActive ? "rgba(205,169,120,0.34)" : "transparent"}`,
                borderRadius: 9,
                textDecoration: "none",
                whiteSpace: "nowrap",
                touchAction: "manipulation",
                flexShrink: 0,
              }}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      <iframe
        key={`${active.id}-${sid}`}
        src={active.url(token, sid)}
        style={{
          flex: 1,
          width: "100%",
          border: "none",
          background: "#050506",
        }}
        allow="clipboard-write"
      />
    </div>
  );
}
