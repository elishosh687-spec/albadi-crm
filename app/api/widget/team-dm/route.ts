/**
 * Message a colleague on WhatsApp — "שלח לסיימון הודעה".
 *
 * GET  → the registry (who can be messaged). No side effects.
 * POST → { to, text, dry? } sends one WhatsApp.
 *
 * The recipient can ONLY be someone already in `app_config.crm.team`, never a
 * raw phone number. That bound is the point: a leaked widget token can annoy
 * Eli's own colleagues, it cannot be used to message arbitrary people.
 *
 * Why an endpoint at all: every messaging credential (GreenAPI / bridge) lives
 * in the Vercel runtime and is masked by `vercel env pull`, so a send can only
 * originate from prod. See lib/notify/team.ts.
 *
 * Auth: ?widget_token= or Authorization: Bearer (GHL_WIDGET_TOKEN).
 */
import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { loadTeam, sendTeamDM } from "@/lib/notify/team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { members, updatedAt } = await loadTeam();
  // Never hand the phone numbers back out — the caller doesn't need them.
  return NextResponse.json({
    ok: true,
    updatedAt: updatedAt ?? null,
    members: members.map(({ id, name, lang, role, aliases }) => ({
      id,
      name,
      lang,
      role,
      aliases: aliases ?? [],
    })),
  });
}

export async function POST(req: NextRequest) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { to?: string; text?: string; dry?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const to = (body.to ?? "").trim();
  const text = (body.text ?? "").trim();
  if (!to || !text) {
    return NextResponse.json(
      { ok: false, error: "missing_to_or_text" },
      { status: 400 },
    );
  }

  if (body.dry) {
    const { members } = await loadTeam();
    const match = members.find(
      (m) =>
        m.id.toLowerCase() === to.toLowerCase() ||
        m.name.toLowerCase() === to.toLowerCase() ||
        (m.aliases ?? []).some((a) => a.toLowerCase() === to.toLowerCase()),
    );
    return NextResponse.json({
      ok: Boolean(match),
      dry: true,
      member: match ? { id: match.id, name: match.name, lang: match.lang } : null,
      chars: text.length,
    });
  }

  const res = await sendTeamDM(to, text);
  if (!res.ok) {
    const code = res.status === "unknown_member" ? 404 : 502;
    return NextResponse.json(res, { status: code });
  }
  return NextResponse.json({
    ok: true,
    status: res.status,
    member: { id: res.member.id, name: res.member.name },
  });
}
