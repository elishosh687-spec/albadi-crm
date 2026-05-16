import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { desc, eq } from "drizzle-orm";
import { STAGE_LABEL, STAGE_TONE } from "@/app/dashboard/v3/_components/stage-meta";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LeadsPage() {
  const rows = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      stage: leads.pipelineStage,
      quoteTotal: leads.quoteTotal,
      botSummary: leads.botSummary,
      notes: leads.notes,
      pipelineFlag: leads.pipelineFlag,
      botPaused: leads.botPaused,
      followUpCount: leads.followUpCount,
      updatedAt: leads.updatedAt,
    })
    .from(leads)
    .where(eq(leads.active, true))
    .orderBy(desc(leads.updatedAt));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">לידים</h1>
        <span className="text-sm text-muted-foreground">{rows.length} לידים פעילים</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-muted-foreground">
              <th className="px-4 py-3 text-right font-medium">שם</th>
              <th className="px-4 py-3 text-right font-medium">טלפון</th>
              <th className="px-4 py-3 text-right font-medium">שלב</th>
              <th className="px-4 py-3 text-right font-medium">הצעה</th>
              <th className="px-4 py-3 text-right font-medium">פולואפים</th>
              <th className="px-4 py-3 text-right font-medium">סיכום</th>
              <th className="px-4 py-3 text-right font-medium">עדכון</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const label = STAGE_LABEL[r.stage ?? ""] ?? r.stage ?? "—";
              const pill = STAGE_TONE[r.stage ?? ""]?.pill ?? "bg-muted text-muted-foreground";
              const updatedAt = r.updatedAt ? new Date(r.updatedAt).toLocaleDateString("he-IL") : "—";
              return (
                <tr key={r.sid} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-medium">
                    <a href={`/dashboard/v3/conversations?jid=${encodeURIComponent(r.sid)}`} className="hover:underline">
                      {r.name ?? "ללא שם"}
                    </a>
                    {r.botPaused && <span className="mr-2 text-xs text-yellow-500">⏸</span>}
                    {r.pipelineFlag === "NEEDS_ELI" && <span className="mr-1 text-xs text-red-400">🔴</span>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground" dir="ltr">{r.phone ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${pill}`}>
                      {label}
                    </span>
                  </td>
                  <td className="px-4 py-3">{r.quoteTotal ? `₪${Number(r.quoteTotal).toLocaleString("he-IL")}` : "—"}</td>
                  <td className="px-4 py-3 text-center">{r.followUpCount ?? 0}</td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[260px] truncate">{r.botSummary ?? r.notes ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{updatedAt}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">אין לידים פעילים</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
