"use client";

/**
 * Tabbed wrapper — combines drafts approval queue + bot decisions history
 * into one widget. "תור אישורים" = pending DraftsView. "החלטות הבוט" =
 * read-only BotDecisionsView.
 */

import { useState } from "react";
import { Inbox, Cpu, Sparkles } from "lucide-react";
import { DraftsView } from "./DraftsView";
import { BotDecisionsView } from "@/components/bot-decisions/BotDecisionsView";
import { BotPreviewView } from "@/components/bot-decisions/BotPreviewView";

type Tab = "drafts" | "decisions" | "preview";

export function DraftsWithDecisions({ apiToken }: { apiToken: string }) {
  const [tab, setTab] = useState<Tab>("drafts");

  return (
    <div className="flex flex-col gap-4" dir="rtl">
      <div className="inline-flex self-start rounded-lg border border-border bg-card/40 p-1 gap-1">
        <TabButton active={tab === "drafts"} onClick={() => setTab("drafts")}>
          <Inbox className="size-3.5" />
          תור אישורים
        </TabButton>
        <TabButton active={tab === "decisions"} onClick={() => setTab("decisions")}>
          <Cpu className="size-3.5" />
          החלטות הבוט
        </TabButton>
        <TabButton active={tab === "preview"} onClick={() => setTab("preview")}>
          <Sparkles className="size-3.5" />
          תצוגה מקדימה
        </TabButton>
      </div>

      <div className="text-xs text-muted-foreground border border-border bg-card/40 rounded-md px-3 py-2 leading-relaxed">
        {tab === "drafts" ? (
          <>
            <strong>תור אישורים:</strong> הודעות שהבוט הכין אבל לא שלח —
            מקרי כסף, התנגדות, או שינוי מפרט. אשר / ערוך / דחה אחת אחת.
          </>
        ) : tab === "decisions" ? (
          <>
            <strong>החלטות הבוט:</strong> היסטוריית כל פעולה של ה-AI על כל ליד
            — מה הלקוח כתב, מה ה-AI החליט, ולמה. קריאה בלבד.
          </>
        ) : (
          <>
            <strong>תצוגה מקדימה:</strong> מה הבוט עומד לעשות ב-36 שעות הקרובות —
            פולואפים מתוכננים, טיוטות, בקשות מפעל, ולידים מושהים. בכל שורה לינק לפתיחת הליד ב-GHL.
          </>
        )}
      </div>

      {tab === "drafts" ? (
        <DraftsView apiToken={apiToken} />
      ) : tab === "decisions" ? (
        <BotDecisionsView apiToken={apiToken} />
      ) : (
        <BotPreviewView apiToken={apiToken} />
      )}
    </div>
  );
}

function TabButton({
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
      className={[
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
