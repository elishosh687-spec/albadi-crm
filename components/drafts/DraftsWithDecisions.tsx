"use client";

/**
 * Tabbed wrapper — combines drafts approval queue + bot decisions history
 * into one widget. "תור אישורים" = pending DraftsView. "החלטות הבוט" =
 * read-only BotDecisionsView.
 */

import { useState } from "react";
import { Inbox, Cpu } from "lucide-react";
import { DraftsView } from "./DraftsView";
import { BotDecisionsView } from "@/components/bot-decisions/BotDecisionsView";

type Tab = "drafts" | "decisions";

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
      </div>

      <div className="text-xs text-muted-foreground border border-border bg-card/40 rounded-md px-3 py-2 leading-relaxed">
        {tab === "drafts" ? (
          <>
            <strong>תור אישורים:</strong> הודעות שהבוט הכין אבל לא שלח —
            מקרי כסף, התנגדות, או שינוי מפרט. אשר / ערוך / דחה אחת אחת.
          </>
        ) : (
          <>
            <strong>החלטות הבוט:</strong> היסטוריית כל פעולה של ה-AI על כל ליד
            — מה הלקוח כתב, מה ה-AI החליט, ולמה. קריאה בלבד.
          </>
        )}
      </div>

      {tab === "drafts" ? (
        <DraftsView apiToken={apiToken} />
      ) : (
        <BotDecisionsView apiToken={apiToken} />
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
