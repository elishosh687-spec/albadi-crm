"use client";

/**
 * Tabbed wrapper — combines drafts approval queue + bot decisions history
 * into one widget under the Silent Luxury hub shell. The mockup shows:
 *   - editorial overline + "תור אישורים." title
 *   - inline pill toggle ("תור · N" champagne-active / "היסטוריה" muted)
 *   - rest of the screen is the active sub-tab.
 */

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { DraftsView } from "./DraftsView";
import { BotDecisionsView } from "@/components/bot-decisions/BotDecisionsView";
import { BotPreviewView } from "@/components/bot-decisions/BotPreviewView";
import { LuxShell, LuxTitle, LuxAccent } from "@/components/widget-ui/lux";

type Tab = "drafts" | "decisions" | "preview";

export function DraftsWithDecisions({ apiToken }: { apiToken: string }) {
  const [tab, setTab] = useState<Tab>("drafts");

  return (
    <LuxShell>
      <LuxTitle
        overline="— Bot approval queue"
        subtitle={
          tab === "drafts"
            ? "הבוט מציע — אתה מאשר, עורך, או דוחה. רגעי כסף, התנגדות, ושינויי מפרט מגיעים לכאן."
            : tab === "decisions"
            ? "כל פעולה של ה-AI על כל ליד — מה הלקוח כתב, מה ה-AI החליט, ולמה. קריאה בלבד."
            : "מה הבוט עומד לעשות ב-36 שעות הקרובות — פולואפים, טיוטות, בקשות מפעל, ולידים מושהים."
        }
        aside={
          <div
            style={{
              display: "inline-flex",
              gap: 4,
              background: "#1d1b1a",
              borderRadius: 9999,
              padding: 4,
              boxShadow: "inset 0 0 0 1px rgba(69,70,77,0.18)",
            }}
          >
            <PillTab active={tab === "drafts"} onClick={() => setTab("drafts")}>
              תור אישורים
            </PillTab>
            <PillTab active={tab === "decisions"} onClick={() => setTab("decisions")}>
              היסטוריה
            </PillTab>
            <PillTab active={tab === "preview"} onClick={() => setTab("preview")}>
              <Sparkles size={12} strokeWidth={2} style={{ marginInlineEnd: 4 }} />
              תצוגה
            </PillTab>
          </div>
        }
      >
        תור <LuxAccent>אישורים.</LuxAccent>
      </LuxTitle>

      {tab === "drafts" ? (
        <DraftsView apiToken={apiToken} />
      ) : tab === "decisions" ? (
        <BotDecisionsView apiToken={apiToken} />
      ) : (
        <BotPreviewView apiToken={apiToken} />
      )}
    </LuxShell>
  );
}

function PillTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "6px 14px",
        border: 0,
        borderRadius: 9999,
        fontSize: 12,
        fontWeight: 500,
        cursor: "pointer",
        color: active ? "#231708" : "#8a7f74",
        background: active
          ? "linear-gradient(180deg,#e7cba6,#cda978)"
          : "transparent",
      }}
    >
      {children}
    </button>
  );
}
