import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { eq, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 30;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const STAGE_LABELS: Record<string, string> = {
  NEW: "חדשים",
  AWAITING_ESTIMATE: "ממתינים להצעה",
  AWAITING_LOGO: "ממתינים ללוגו",
  WAITING_FACTORY: "אצל המפעל",
  AWAITING_FINAL: "ממתינים לאישור סופי",
  WON: "נסגרו",
  DROPPED: "ננטשו",
};

async function fetchLeads(stage?: string) {
  const q = db.select({
    name: leads.name,
    phone: leads.phoneE164,
    stage: leads.pipelineStage,
    notes: leads.notes,
    botSummary: leads.botSummary,
    quoteTotal: leads.quoteTotal,
    followUpCount: leads.followUpCount,
    lastFollowUpAt: leads.lastFollowUpAt,
    botPaused: leads.botPaused,
    pipelineFlag: leads.pipelineFlag,
    updatedAt: leads.updatedAt,
  }).from(leads);

  if (stage && stage !== "ALL") {
    return q.where(eq(leads.pipelineStage, stage)).limit(40);
  }
  return q.limit(60);
}

function buildLeadContext(rows: Awaited<ReturnType<typeof fetchLeads>>) {
  if (!rows.length) return "אין לידים תואמים.";
  return rows
    .map((r, i) => {
      const parts = [
        `${i + 1}. ${r.name ?? "ללא שם"} (${r.phone ?? "?"})`,
        `   שלב: ${STAGE_LABELS[r.stage ?? ""] ?? r.stage ?? "לא ידוע"}`,
      ];
      if (r.botSummary) parts.push(`   סיכום: ${r.botSummary}`);
      if (r.quoteTotal) parts.push(`   הצעה: ₪${r.quoteTotal}`);
      if (r.notes) parts.push(`   הערות: ${r.notes}`);
      if (r.followUpCount) parts.push(`   פולואפים: ${r.followUpCount}`);
      if (r.botPaused) parts.push(`   בוט מושהה: כן`);
      if (r.pipelineFlag) parts.push(`   דגל: ${r.pipelineFlag}`);
      if (r.lastFollowUpAt) parts.push(`   עדכון אחרון: ${new Date(r.lastFollowUpAt).toLocaleDateString("he-IL")}`);
      return parts.join("\n");
    })
    .join("\n\n");
}

export async function POST(req: NextRequest) {
  let body: { message: string; stage?: string; history?: { role: "user" | "assistant"; content: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { message, stage, history = [] } = body;
  if (!message?.trim()) return NextResponse.json({ error: "no message" }, { status: 400 });

  const rows = await fetchLeads(stage);
  const leadContext = buildLeadContext(rows);
  const stageLabel = stage && stage !== "ALL" ? (STAGE_LABELS[stage] ?? stage) : "כל הלידים";

  const systemPrompt = `אתה עוזר CRM חכם של אלבדי — חברת שקיות ממותגות.
אתה עוזר לאלי (המנהל) לנהל את הלידים שלו ולקבל החלטות.
ענה בעברית. היה תמציתי, ישיר, מועיל. אל תחזור על הנתונים — נתח אותם.

שלב נוכחי שנבחר: ${stageLabel}
מספר לידים: ${rows.length}

נתוני לידים:
${leadContext}`;

  const messages: Anthropic.MessageParam[] = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: message },
  ];

  const stream = await client.messages.stream({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
