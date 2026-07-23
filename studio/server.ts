/**
 * Bag Studio — local server (runs ONLY on Eli's Mac).
 *
 *   WIDGET_TOKEN=<GHL_WIDGET_TOKEN> npm start        # then open http://localhost:4747
 *
 * Serves the chat UI, runs the Claude agent (with the mockup + dieline skills)
 * in a per-customer work dir, and proxies file push / WhatsApp send to the CRM.
 * Nothing here is deployed — it needs the local skills + your Gemini/Veo keys.
 */
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { runAgent } from "./agent.ts";
import {
  ROOT, TOKEN, CRM_BASE, pullDeal, pushFile, sendWhatsApp, listOutputs, ensureDir, briefText,
} from "./lib.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4747);

function safeKey(k: string): string {
  return (k || "adhoc").replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 80) || "adhoc";
}
function workDir(sessionKey: string): string {
  return join(ROOT, safeKey(sessionKey));
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}
async function readJson<T>(req: IncomingMessage): Promise<T> {
  const b = await readBody(req);
  return JSON.parse(b.toString("utf8") || "{}") as T;
}
function json(res: ServerResponse, code: number, body: unknown) {
  const s = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(s);
}
const CT: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".mp4": "video/mp4", ".webm": "video/webm",
  ".mov": "video/quicktime", ".pdf": "application/pdf",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://localhost:${PORT}`);
    const p = url.pathname;

    // ---- static ----
    if (req.method === "GET" && (p === "/" || p === "/index.html")) {
      const html = await readFile(join(HERE, "public", "index.html"));
      res.writeHead(200, { "content-type": CT[".html"] });
      return res.end(html);
    }
    if (req.method === "GET" && p === "/app.js") {
      const js = await readFile(join(HERE, "public", "app.js"));
      res.writeHead(200, { "content-type": CT[".js"] });
      return res.end(js);
    }

    // ---- load a deal's brief ----
    if (req.method === "GET" && p === "/api/deal") {
      const dealId = url.searchParams.get("dealId") || "";
      if (!dealId) return json(res, 400, { ok: false, error: "missing dealId" });
      const brief = await pullDeal(dealId);
      const dir = workDir(dealId);
      await ensureDir(dir);
      return json(res, 200, { ok: true, brief, sessionKey: dealId, briefText: briefText(brief) });
    }

    // ---- upload a file into the work dir (raw body + X-Filename) ----
    if (req.method === "POST" && p === "/api/upload") {
      const key = safeKey(url.searchParams.get("session") || "adhoc");
      const name = basename(req.headers["x-filename"] as string || "upload.bin").replace(/[^a-zA-Z0-9_.\-]/g, "_");
      const dir = workDir(key);
      await ensureDir(dir);
      const buf = await readBody(req);
      await writeFile(join(dir, name), buf);
      return json(res, 200, { ok: true, name, path: join(dir, name) });
    }

    // ---- list outputs in the work dir ----
    if (req.method === "GET" && p === "/api/outputs") {
      const key = safeKey(url.searchParams.get("session") || "adhoc");
      const files = await listOutputs(workDir(key));
      return json(res, 200, { ok: true, files });
    }

    // ---- serve a work-dir file ----
    if (req.method === "GET" && p === "/api/file") {
      const key = safeKey(url.searchParams.get("session") || "adhoc");
      const name = basename(url.searchParams.get("name") || "");
      if (!name) return json(res, 400, { ok: false, error: "missing name" });
      const buf = await readFile(join(workDir(key), name)).catch(() => null);
      if (!buf) return json(res, 404, { ok: false, error: "not found" });
      res.writeHead(200, { "content-type": CT[extname(name).toLowerCase()] || "application/octet-stream" });
      return res.end(buf);
    }

    // ---- push a file into the deal timeline ----
    if (req.method === "POST" && p === "/api/push") {
      const body = await readJson<{ dealId: string; stage: string; session: string; name: string }>(req);
      const file = join(workDir(body.session), basename(body.name));
      const uploaded = await pushFile(body.dealId, body.stage, file);
      return json(res, 200, { ok: true, url: uploaded });
    }

    // ---- send a file to the lead on WhatsApp ----
    if (req.method === "POST" && p === "/api/whatsapp") {
      const body = await readJson<{ leadSid: string; session: string; name: string }>(req);
      const file = join(workDir(body.session), basename(body.name));
      const wa = await sendWhatsApp(body.leadSid, file);
      return json(res, 200, { ok: true, waMessageId: wa });
    }

    // ---- chat (SSE stream from the Claude agent) ----
    if (req.method === "POST" && p === "/api/chat") {
      const body = await readJson<{ message: string; sessionKey: string; claudeSessionId: string | null }>(req);
      const key = safeKey(body.sessionKey || "adhoc");
      const dir = workDir(key);
      await ensureDir(dir);
      const before = new Set((await listOutputs(dir)).map((f) => f.name));

      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache", connection: "keep-alive",
      });
      const send = (ev: unknown) => res.write(`data: ${JSON.stringify(ev)}\n\n`);

      for await (const ev of runAgent(body.message, dir, body.claudeSessionId, (s) => send({ kind: "stderr", text: s }))) {
        if (ev.kind === "done") {
          const after = await listOutputs(dir);
          const fresh = after.filter((f) => !before.has(f.name));
          send({ kind: "done", sessionId: ev.sessionId, result: ev.result, newFiles: fresh, allFiles: after });
        } else {
          send(ev);
        }
      }
      return res.end();
    }

    json(res, 404, { ok: false, error: "not found" });
  } catch (e) {
    json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

if (!TOKEN) {
  console.error("\n✗ חסר WIDGET_TOKEN (משתנה סביבה). קבל מ-Vercel env GHL_WIDGET_TOKEN.\n  דוגמה:  WIDGET_TOKEN=xxxx npm start\n");
  process.exit(1);
}
server.listen(PORT, () => {
  console.log(`\n  🎨 סטודיו אלבדי רץ:  http://localhost:${PORT}`);
  console.log(`     CRM: ${CRM_BASE}`);
  console.log(`     קבצים: ${ROOT}/<lead|deal>\n`);
});
