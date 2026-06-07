import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { eq, isNull } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 30;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

const STAGE_LABELS: Record<string, string> = {
  PRE_QUOTE: "בשאלון",
  INTAKE: "שאלון + הצעה אוטומטית",
  DISCAVERY: "שיחת בירור",
  FACTORY_WAIT: "בדיקת מפעל",
  CONSIDERATION: "שוקל הצעה / מו״מ",
  WON: "נסגר",
  LOST: "לא נסגר",
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
  }).from(leads);

  if (stage && stage !== "ALL") {
    if (stage === "PRE_QUOTE") {
      return q.where(isNull(leads.pipelineStage)).limit(40);
    }
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
      if (r.lastFollowUpAt) parts.push(`   עדכון: ${new Date(r.lastFollowUpAt).toLocaleDateString("he-IL")}`);
      return parts.join("\n");
    })
    .join("\n\n");
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no api key" }, { status: 503 });

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
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const systemPrompt = `אתה עוזר CRM חכם של אלבדי — חברת שקיות ממותגות.
אתה עוזר לאלי (המנהל) לנהל את הלידים שלו ולקבל החלטות.
ענה בעברית. היה תמציתי, ישיר, מועיל. נתח את הנתונים — אל תחזור עליהם כרשימה.

שלב נוכחי: ${stageLabel} | סה"כ לידים: ${rows.length}

נתוני לידים:
${leadContext}`;

  const messages = [
    ...history.slice(-8).map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: message },
  ];

  const upstream = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, stream: true, temperature: 0.3, max_tokens: 1024, messages: [{ role: "system", content: systemPrompt }, ...messages] }),
  });

  if (!upstream.ok || !upstream.body) {
    const err = await upstream.text();
    return NextResponse.json({ error: err }, { status: 502 });
  }

  // Pass-through the SSE stream, extracting only the text deltas
  const encoder = new TextEncoder();
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();

  const readable = new ReadableStream({
    async start(controller) {
      let buf = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") break;
            try {
              const json = JSON.parse(data);
              const text = json.choices?.[0]?.delta?.content;
              if (text) controller.enqueue(encoder.encode(text));
            } catch {}
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
