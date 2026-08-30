/**
 * Internal team contacts — the people Eli works WITH, as opposed to leads.
 *
 * Why this exists: mid-session Eli says "שלח לסיימון הודעה" and expects that to
 * just work. Without a registry the only options were bad ones — guess a number,
 * or add the person to `leads`, where the bot would follow them up and they'd
 * pollute the pipeline and every analytics screen.
 *
 * Colleagues are NOT leads. They live in `app_config` under `crm.team`, exactly
 * like the quote-notify recipient (see quote-notify-config.ts) — DB, not code,
 * so a phone number never lands in git and re-pointing needs no redeploy.
 *
 * Server-only (touches the DB).
 */
import { db } from "@/lib/db";
import { appConfig } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { sendBridgeMessage, resolveJidFromPhone } from "../bridge/client";
import { isJid } from "../bridge/jid";

const KEY = "crm.team";

export interface TeamMember {
  /** Stable handle — the word Eli actually says. Lowercase, no spaces. */
  id: string;
  /** Display name. */
  name: string;
  /** E.164 digits, no "+". A JID is accepted too and used as-is. */
  phone: string;
  /** What language to write to them in — the caller decides the wording. */
  lang: "he" | "zh" | "en";
  /** What they do, so a future session knows when to involve them. */
  role: string;
  /** Other spellings Eli might use — Hebrew, Chinese, nicknames. */
  aliases?: string[];
}

export interface TeamConfig {
  members: TeamMember[];
  updatedAt?: string;
}

const EMPTY: TeamConfig = { members: [] };

export async function loadTeam(): Promise<TeamConfig> {
  try {
    const [row] = await db
      .select()
      .from(appConfig)
      .where(eq(appConfig.key, KEY))
      .limit(1);
    const v = row?.value as TeamConfig | undefined;
    if (!v || !Array.isArray(v.members)) return EMPTY;
    return v;
  } catch {
    return EMPTY;
  }
}

export async function setTeam(members: TeamMember[]): Promise<void> {
  const value: TeamConfig = { members, updatedAt: new Date().toISOString() };
  await db
    .insert(appConfig)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: appConfig.key, set: { value } });
}

/** Add or replace one member, keeping the rest. Idempotent on `id`. */
export async function upsertTeamMember(member: TeamMember): Promise<TeamMember[]> {
  const { members } = await loadTeam();
  const next = members.filter((m) => m.id !== member.id).concat(member);
  await setTeam(next);
  return next;
}

export async function removeTeamMember(id: string): Promise<TeamMember[]> {
  const { members } = await loadTeam();
  const next = members.filter((m) => m.id !== id);
  await setTeam(next);
  return next;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** Match on id, name, or any alias — so "simon" / "סיימון" / "西蒙" all land. */
export async function findMember(query: string): Promise<TeamMember | null> {
  const q = norm(query);
  if (!q) return null;
  const { members } = await loadTeam();
  return (
    members.find((m) => norm(m.id) === q) ??
    members.find((m) => norm(m.name) === q) ??
    members.find((m) => (m.aliases ?? []).some((a) => norm(a) === q)) ??
    members.find((m) => norm(m.name).includes(q) || q.includes(norm(m.id))) ??
    null
  );
}

/**
 * Is this number a colleague rather than a customer?
 *
 * The inbound webhook has to ask this BEFORE it creates a lead. Registering
 * Simon only protected the outbound direction — when he replied on 2026-08-27
 * the webhook saw an unknown number, made him a lead, and the bot sent him the
 * Hebrew questionnaire and then a follow-up nudge. He wrote back "can you
 * explain to me in English?" and Eli had to apologise for the bot.
 *
 * Accepts a chatId ("8615…@c.us"), a JID, or bare digits — compares on digits
 * only, so the suffix and any "+" are irrelevant.
 */
export async function findTeamMemberByPhone(
  phoneOrJid: string,
): Promise<TeamMember | null> {
  const digits = String(phoneOrJid).split("@")[0].replace(/[^0-9]/g, "");
  if (!digits) return null;
  const { members } = await loadTeam();
  return (
    members.find((m) => m.phone.replace(/[^0-9]/g, "") === digits) ?? null
  );
}

// Same reasoning as notify/itay.ts: cache the resolved JID per raw target so
// changing a number in settings takes effect without a redeploy.
const jidCache = new Map<string, string | null>();

async function resolveTargetJid(raw: string): Promise<string | null> {
  const key = raw.trim();
  if (!key) return null;
  if (jidCache.has(key)) return jidCache.get(key) ?? null;
  const jid = isJid(key) ? key : await resolveJidFromPhone(key);
  jidCache.set(key, jid);
  return jid;
}

export type TeamDMResult =
  | { ok: true; status: "sent" | "dry_run"; member: TeamMember }
  | { ok: false; status: "unknown_member" | "no_jid" | "error"; error?: string };

/**
 * WhatsApp one colleague. Never throws — a failed internal DM must not take
 * down whatever the caller was really doing.
 */
export async function sendTeamDM(
  query: string,
  text: string,
): Promise<TeamDMResult> {
  try {
    const member = await findMember(query);
    if (!member) return { ok: false, status: "unknown_member" };

    if (process.env.BRIDGE_DRY_RUN === "1") {
      const preview = text.length > 120 ? `${text.slice(0, 120)}…` : text;
      console.log(
        `[notify.team.dryrun] → ${member.name}: ${preview.replace(/\n/g, " ⏎ ")}`,
      );
      return { ok: true, status: "dry_run", member };
    }

    const jid = await resolveTargetJid(member.phone);
    if (!jid) return { ok: false, status: "no_jid" };

    // sender='eli' — this is Eli writing to a colleague, not the bot talking.
    await sendBridgeMessage(jid, text, undefined, "eli");
    console.log(`[notify.team] DM sent to ${member.name}`);
    return { ok: true, status: "sent", member };
  } catch (e) {
    console.error("[notify.team] send failed:", e);
    return { ok: false, status: "error", error: String(e) };
  }
}
