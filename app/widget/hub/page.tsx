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
    label: "🏭 מפעל",
    url: (t, sid) => withSid(`/widget/factory-flow?widget_token=${encodeURIComponent(t)}`, sid),
  },
  {
    id: "calc",
    label: "🧮 מחשבון",
    url: (t, sid) => withSid(`/widget/calculator?widget_token=${encodeURIComponent(t)}`, sid),
  },
  {
    id: "order",
    label: "📋 הזמנה",
    url: (t, sid) => withSid(`/widget/order-summary?widget_token=${encodeURIComponent(t)}`, sid),
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
      dir="rtl"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        margin: "-16px",
      }}
    >
      <nav
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          padding: "8px 8px 0 8px",
          background: "#0d0f14",
          borderBottom: "1px solid #2a2d34",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        {TABS.map((t) => {
          const isActive = t.id === activeId;
          const sidSuffix = sid ? `&sid=${encodeURIComponent(sid)}` : "";
          const href = `/widget/hub?widget_token=${encodeURIComponent(token)}&tab=${t.id}${sidSuffix}`;
          return (
            <Link
              key={t.id}
              href={href}
              style={{
                padding: "8px 12px",
                fontSize: 14,
                background: isActive ? "#2a2d34" : "transparent",
                color: isActive ? "#e4e4e7" : "#a1a1aa",
                border: "1px solid #2a2d34",
                borderBottom: isActive ? "1px solid #2a2d34" : "1px solid transparent",
                borderRadius: "6px 6px 0 0",
                textDecoration: "none",
                whiteSpace: "nowrap",
                touchAction: "manipulation",
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
          background: "#0d0f14",
        }}
        allow="clipboard-write"
      />
    </div>
  );
}
