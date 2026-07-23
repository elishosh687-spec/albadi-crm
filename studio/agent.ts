/**
 * Thin wrapper over the Claude Agent SDK. Runs a local Claude session that has
 * the bag-mockup-video + dieline-print skills enabled, in a per-customer working
 * dir where the skills write their outputs. Yields simplified events for the
 * server to stream to the browser over SSE.
 *
 * Multi-turn: pass the previous `sessionId` to continue the same conversation
 * (so "תגדיל את הלוגו" refers back to the last mockup).
 */
import { query } from "@anthropic-ai/claude-agent-sdk";

export type AgentEvent =
  | { kind: "text"; text: string }
  | { kind: "tool"; label: string }
  | { kind: "done"; sessionId: string; result: string }
  | { kind: "error"; error: string };

const SYSTEM = `אתה עוזר הסטודיו של "אלבדי" — עסק שמייצר שקיות אלבד (non-woven) בהתאמה אישית.
המשתמש (אלי / איתי) מדבר איתך בעברית כדי:
1. לייצר הדמיה (mockup) ריאליסטית של שקית עם לוגו הלקוח — השתמש ב-Skill "bag-mockup-video".
2. לייצר קובץ הפקה (פריסה) — לוגו על פריסת המפעל — השתמש ב-Skill "dieline-print".

כללי עבודה:
- אתה רץ ללא אדם שיענה על שאלות אינטראקטיביות. אל תשאל שאלות מיותרות — קח את הפרטים
  מהבריף ומהודעות המשתמש, ואם חסר פרט קריטי בחר ברירת מחדל סבירה וציין אותה.
- שמור כל תמונה/וידאו/PDF שאתה מייצר בתיקיית העבודה הנוכחית (cwd) — משם המערכת מציגה
  ומעלה אותם. תן שמות קבצים ברורים באנגלית (למשל gold-baby-mockup-v1.png).
- כשסיימת פלט, אמור בקצרה מה יצרת ובאיזה שם קובץ.
- ענה בעברית, קצר וענייני.`;

export async function* runAgent(
  message: string,
  cwd: string,
  sessionId: string | null,
  onStderr?: (s: string) => void
): AsyncGenerator<AgentEvent> {
  let sid = sessionId ?? "";
  try {
    const stream = query({
      prompt: message,
      options: {
        cwd,
        systemPrompt: { type: "preset", preset: "claude_code", append: SYSTEM },
        settingSources: ["user", "project", "local"],
        skills: ["bag-mockup-video", "dieline-print"],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        ...(sessionId ? { resume: sessionId } : {}),
        stderr: onStderr,
      } as Parameters<typeof query>[0]["options"],
    });

    for await (const msg of stream) {
      const m = msg as { type: string; session_id?: string; message?: { content?: unknown[] }; subtype?: string; result?: string };
      if (m.session_id) sid = m.session_id;

      if (m.type === "assistant" && Array.isArray(m.message?.content)) {
        for (const block of m.message!.content as { type: string; text?: string; name?: string; input?: Record<string, unknown> }[]) {
          if (block.type === "text" && block.text) {
            yield { kind: "text", text: block.text };
          } else if (block.type === "tool_use") {
            yield { kind: "tool", label: toolLabel(block.name, block.input) };
          }
        }
      } else if (m.type === "result") {
        yield { kind: "done", sessionId: sid, result: m.result ?? "" };
        return;
      }
    }
    yield { kind: "done", sessionId: sid, result: "" };
  } catch (e) {
    yield { kind: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

function toolLabel(name?: string, input?: Record<string, unknown>): string {
  if (!name) return "פעולה…";
  if (name === "Skill") return `סקיל: ${String(input?.command ?? input?.name ?? "")}`.trim();
  if (name === "Bash") {
    const cmd = String(input?.command ?? "");
    return `הרצה: ${cmd.slice(0, 70)}${cmd.length > 70 ? "…" : ""}`;
  }
  if (name === "Write" || name === "Edit") return `כותב קובץ…`;
  return `${name}…`;
}
