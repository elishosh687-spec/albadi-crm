/**
 * Dual-provider wrapper for the local studio. Claude uses the Agent SDK; Codex
 * uses the locally signed-in CLI. Both run in the per-customer working directory
 * and yield the same simplified events for the server to stream over SSE.
 *
 * Multi-turn: pass the previous `sessionId` to continue the same conversation
 * (so "תגדיל את הלוגו" refers back to the last mockup).
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

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
  const provider = (process.env.ALBADI_STUDIO_PROVIDER || "claude").trim().toLowerCase();
  if (provider === "codex") {
    yield* runCodexAgent(message, cwd, sessionId, onStderr);
    return;
  }
  if (provider !== "claude") {
    yield { kind: "error", error: `ALBADI_STUDIO_PROVIDER must be codex or claude, got ${provider}` };
    return;
  }
  yield* runClaudeAgent(message, cwd, sessionId, onStderr);
}

async function* runClaudeAgent(
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

async function* runCodexAgent(
  message: string,
  cwd: string,
  sessionId: string | null,
  onStderr?: (s: string) => void
): AsyncGenerator<AgentEvent> {
  const executable = process.env.CODEX_CLI_PATH || "/Applications/ChatGPT.app/Contents/Resources/codex";
  const args = sessionId
    ? ["exec", "resume", "--json", "--ignore-user-config", "--disable", "hooks", "--skip-git-repo-check", sessionId, "-"]
    : ["exec", "--json", "--ignore-user-config", "--disable", "hooks", "--cd", cwd, "--approve-for-me", "--skip-git-repo-check", "-"];
  const prompt = sessionId ? message : `${SYSTEM}\n\nבקשת המשתמש:\n${message}`;
  let sid = sessionId ?? "";
  let lastText = "";
  let spawnError = "";

  const child = spawn(executable, args, { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
  child.on("error", (error) => { spawnError = error.message; });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => onStderr?.(chunk));
  child.stdin.end(prompt);

  const lines = createInterface({ input: child.stdout });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      onStderr?.(`[codex non-JSON output] ${line}\n`);
      continue;
    }
    if (event.type === "thread.started" && typeof event.thread_id === "string") {
      sid = event.thread_id;
      continue;
    }
    const item = event.item as Record<string, unknown> | undefined;
    if (event.type === "item.completed" && item?.type === "agent_message" && typeof item.text === "string") {
      lastText = item.text;
      yield { kind: "text", text: item.text };
    } else if (event.type === "item.started" && item) {
      const label = codexToolLabel(item);
      if (label) yield { kind: "tool", label };
    } else if (event.type === "turn.failed") {
      const error = event.error as { message?: string } | undefined;
      spawnError = error?.message || "Codex turn failed";
    }
  }

  const exitCode = await new Promise<number | null>((resolve) => child.once("close", resolve));
  if (spawnError || exitCode !== 0) {
    yield { kind: "error", error: spawnError || `Codex exited with code ${exitCode}` };
    return;
  }
  yield { kind: "done", sessionId: sid, result: lastText };
}

function codexToolLabel(item: Record<string, unknown>): string {
  if (item.type === "command_execution") {
    const command = String(item.command ?? "");
    return `הרצה: ${command.slice(0, 70)}${command.length > 70 ? "…" : ""}`;
  }
  if (item.type === "mcp_tool_call") return `כלי: ${String(item.tool ?? "")}`;
  if (item.type === "file_change") return "כותב קובץ…";
  return "";
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
