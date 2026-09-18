import Link from "next/link";
import type { CSSProperties } from "react";
import {
  MessagesSquare,
  Receipt,
  BarChart3,
  Megaphone,
  Calculator,
  SwatchBook,
  Swords,
  Box,
  Package,
  Settings,
  CircleCheckBig,
  FlaskConical,
  Inbox,
  Ellipsis,
  type LucideIcon,
} from "lucide-react";

export type HubMode = "widget" | "standalone";

interface TabDef {
  id: string;
  label: string;
  icon: LucideIcon;
  path: string;
  acceptsSid?: boolean;
}

export const HUB_TABS: TabDef[] = [
  { id: "inbox", label: "שיחות", icon: MessagesSquare, path: "/widget/inbox", acceptsSid: true },
  { id: "drafts", label: "אישורים", icon: Inbox, path: "/widget/drafts" },
  { id: "factory", label: "הצעות מחיר", icon: Receipt, path: "/widget/factory-flow", acceptsSid: true },
  { id: "closed", label: "עסקאות", icon: CircleCheckBig, path: "/widget/closed-quotes" },
  { id: "analytics", label: "אנליטיקה", icon: BarChart3, path: "/widget/analytics" },
  { id: "playground", label: "מגרש בדיקות", icon: FlaskConical, path: "/widget/playground" },
  { id: "calc", label: "מחשבון", icon: Calculator, path: "/widget/calculator", acceptsSid: true },
  { id: "colors", label: "צבעים", icon: SwatchBook, path: "/widget/colors" },
  { id: "ads", label: "מודעות", icon: Megaphone, path: "/widget/ads" },
  { id: "competitors", label: "מחיר מתחרים", icon: Swords, path: "/widget/competitors", acceptsSid: true },
  { id: "designer", label: "מעצב 3D", icon: Box, path: "/configurator" },
  { id: "shipping", label: "צירוף משלוחים", icon: Package, path: "/widget/shipping" },
  { id: "settings", label: "הגדרות", icon: Settings, path: "/widget/settings" },
];

/** Deep-link params a tab may receive from the hub URL, e.g.
 *  `?tab=settings&section=ads` or `?tab=analytics&view=ops`. */
export interface HubDeepLink {
  view?: string;
  section?: string;
}

/** The four tabs the team uses most on a phone — the bottom bar (ui-ux-pro-max:
 *  ≤5 items, icon + label). Everything else sits behind "עוד". Eli, 18/09. */
export const HUB_PRIMARY_TAB_IDS = ["inbox", "drafts", "factory", "closed"] as const;

function appendParams(
  path: string,
  mode: HubMode,
  widgetToken: string,
  sid: string,
  acceptsSid = false,
  deepLink: HubDeepLink = {}
): string {
  const params = new URLSearchParams();
  if (mode === "widget") params.set("widget_token", widgetToken);
  if (acceptsSid && sid) params.set("sid", sid);
  if (deepLink.view) params.set("view", deepLink.view);
  if (deepLink.section) params.set("section", deepLink.section);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function hubHref(
  mode: HubMode,
  widgetToken: string,
  tab: string,
  sid: string
): string {
  const params = new URLSearchParams({ tab });
  if (mode === "widget") params.set("widget_token", widgetToken);
  if (sid) params.set("sid", sid);
  return `${mode === "widget" ? "/widget/hub" : "/"}?${params.toString()}`;
}

export function HubShell({
  mode,
  widgetToken = "",
  activeTab,
  sid = "",
  deepLink = {},
}: {
  mode: HubMode;
  widgetToken?: string;
  activeTab?: string;
  sid?: string;
  deepLink?: HubDeepLink;
}) {
  const active = HUB_TABS.find((tab) => tab.id === activeTab) ?? HUB_TABS[0];
  const isPrimary = (id: string) => (HUB_PRIMARY_TAB_IDS as readonly string[]).includes(id);
  const primary = HUB_PRIMARY_TAB_IDS.map((id) => HUB_TABS.find((t) => t.id === id)!).filter(Boolean);
  const others = HUB_TABS.filter((t) => !isPrimary(t.id));
  const activeIsPrimary = isPrimary(active.id);

  return (
    <div
      className="lux-theme"
      dir="rtl"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        margin: "calc(-1 * clamp(6px, 2vw, 12px))",
        overscrollBehavior: "contain",
        background: "#0d0c0b",
      }}
    >
      <nav
        className="hub-nav"
        aria-label="לשוניות"
        style={{
          display: "flex",
          flexWrap: "nowrap",
          alignItems: "center",
          gap: 4,
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

        {HUB_TABS.map((tab) => {
          const isActive = tab.id === active.id;
          const Icon = tab.icon;
          const style: CSSProperties = {
            gap: 6,
            padding: "0 11px",
            scrollSnapAlign: "center",
            fontSize: 13,
            fontWeight: isActive ? 600 : 500,
            height: 44,
            display: "flex",
            alignItems: "center",
            background: isActive ? "rgba(214,196,172,0.14)" : "transparent",
            color: isActive ? "#e6e1e0" : "#a0958a",
            border: `1px solid ${isActive ? "rgba(214,196,172,0.30)" : "transparent"}`,
            borderRadius: 7,
            textDecoration: "none",
            whiteSpace: "nowrap",
            touchAction: "manipulation",
            flexShrink: 0,
          };
          return (
            <Link
              key={tab.id}
              href={hubHref(mode, widgetToken, tab.id, sid)}
              style={style}
              className="hub-nav-link"
              data-active={isActive ? "1" : undefined}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon size={15} strokeWidth={1.75} style={{ flexShrink: 0 }} />
              {tab.label}
            </Link>
          );
        })}

      </nav>

      <script
        dangerouslySetInnerHTML={{
          __html:
            "document.querySelector('.hub-nav [data-active]')" +
            "?.scrollIntoView({block:'nearest',inline:'center'});",
        }}
      />

      <iframe
        key={`${mode}-${active.id}-${sid}`}
        src={appendParams(active.path, mode, widgetToken, sid, active.acceptsSid, deepLink)}
        style={{ flex: 1, width: "100%", border: "none", background: "#1d1b1a" }}
        allow="clipboard-write"
      />

      {/* Phone only (CSS): bottom bar with the four main tabs + "עוד". The
          <details> sheet needs no JS; every link reloads the hub anyway. */}
      <nav className="hub-bottom" aria-label="לשוניות ראשיות">
        {primary.map((tab) => (
          <BottomItem key={tab.id} tab={tab} href={hubHref(mode, widgetToken, tab.id, sid)} active={tab.id === active.id} />
        ))}
        <details className="hub-more">
          <summary className="hub-bottom-item" aria-current={activeIsPrimary ? undefined : "page"}>
            {activeIsPrimary ? <Ellipsis size={22} strokeWidth={1.75} aria-hidden /> : <active.icon size={22} strokeWidth={1.75} aria-hidden />}
            <span>{activeIsPrimary ? "עוד" : active.label}</span>
          </summary>
          <div className="hub-more-sheet" role="list" aria-label="עוד לשוניות">
            {others.map((tab) => {
              const Icon = tab.icon;
              return (
                <Link key={tab.id} role="listitem" className="hub-more-link" href={hubHref(mode, widgetToken, tab.id, sid)} aria-current={tab.id === active.id ? "page" : undefined}>
                  <Icon size={18} strokeWidth={1.75} aria-hidden />
                  {tab.label}
                </Link>
              );
            })}
          </div>
        </details>
      </nav>
    </div>
  );
}

function BottomItem({ tab, href, active }: { tab: TabDef; href: string; active: boolean }) {
  const Icon = tab.icon;
  return (
    <Link className="hub-bottom-item" href={href} aria-current={active ? "page" : undefined}>
      <Icon size={22} strokeWidth={1.75} aria-hidden />
      <span>{tab.label}</span>
    </Link>
  );
}
