"use client";

/**
 * Salesperson tab shell — two sub-tabs under the one GHL menu link:
 *   • מחשבון מכירות     — instant catalog price → send (SalesCalculator)
 *   • בקשת הצעה מהמפעל  — spec request for non-standard bags → parks a draft +
 *                          DMs Eli (the existing SalesQuoteRequestForm, sales mode)
 * Both run on the sales token; neither surfaces cost/profit/margin/commission.
 */
import { useState } from "react";
import { Calculator, FileText, History } from "lucide-react";
import { cn } from "@/lib/cn";
import { SalesCalculator } from "./SalesCalculator";
import { SalesHistory } from "./SalesHistory";
import { SalesQuoteRequestForm } from "@/components/factory-request/SalesQuoteRequestForm";

export function SalesShell({ token }: { token: string }) {
  const [tab, setTab] = useState<"calc" | "request" | "history">("calc");
  return (
    <div dir="rtl" className="mx-auto max-w-xl p-3">
      <div className="mb-3 inline-flex rounded-lg border border-border p-0.5 bg-card/40">
        <button
          type="button"
          onClick={() => setTab("calc")}
          className={cn(
            "px-3.5 py-2 rounded-md text-sm inline-flex items-center gap-1.5 transition-colors",
            tab === "calc" ? "bg-primary/15 text-foreground" : "text-muted-foreground"
          )}
        >
          <Calculator className="size-4" /> מחשבון מכירות
        </button>
        <button
          type="button"
          onClick={() => setTab("request")}
          className={cn(
            "px-3.5 py-2 rounded-md text-sm inline-flex items-center gap-1.5 transition-colors",
            tab === "request" ? "bg-primary/15 text-foreground" : "text-muted-foreground"
          )}
        >
          <FileText className="size-4" /> בקשת הצעה מהמפעל
        </button>
        <button
          type="button"
          onClick={() => setTab("history")}
          className={cn(
            "px-3.5 py-2 rounded-md text-sm inline-flex items-center gap-1.5 transition-colors",
            tab === "history" ? "bg-primary/15 text-foreground" : "text-muted-foreground"
          )}
        >
          <History className="size-4" /> היסטוריה
        </button>
      </div>

      {tab === "calc" ? (
        <SalesCalculator token={token} />
      ) : tab === "request" ? (
        <SalesQuoteRequestForm apiToken={token} salesMode />
      ) : (
        <SalesHistory token={token} />
      )}
    </div>
  );
}
