import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { escalations } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { addTag, removeTag, getSubscriber, setCustomFields, getFieldValue } from "@/lib/manychat/client";
import { TAG_IDS, STATUS_TAG_IDS, type TagName } from "@/lib/manychat/config";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { id: number; tag: string };
  const { id, tag } = body;

  if (!id || !tag) {
    return NextResponse.json({ error: "missing id or tag" }, { status: 400 });
  }

  if (!(tag in TAG_IDS)) {
    return NextResponse.json({ error: "invalid tag" }, { status: 400 });
  }

  const [esc] = await db.select().from(escalations).where(eq(escalations.id, id));
  if (!esc) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const tagId = TAG_IDS[tag as TagName];
  const subscriberId = esc.manychatSubId;

  try {
    const sub = await getSubscriber(subscriberId);
    const conflicting = sub.tags
      .map((t) => t.id)
      .filter((tid) => STATUS_TAG_IDS.includes(tid) && tid !== tagId);

    for (const tid of conflicting) {
      try {
        await removeTag(subscriberId, tid);
      } catch (e) {
        console.error(`removeTag ${tid} failed:`, e);
      }
    }

    await addTag(subscriberId, tagId);

    const currentNotes = String(getFieldValue(sub.custom_fields, "notes") ?? "");
    const date = new Date().toLocaleDateString("he-IL");
    const reason = esc.suggestedTagReason ? ` (${esc.suggestedTagReason})` : "";
    const stamp = `[${date}] הוחל תג: ${tag}${reason}`;
    const merged = currentNotes.includes(stamp)
      ? currentNotes
      : `${currentNotes}\n${stamp}`.trim().slice(0, 4000);

    try {
      await setCustomFields(subscriberId, [{ name: "notes", value: merged }]);
    } catch (e) {
      console.error("ManyChat notes update failed:", e);
    }
  } catch (e) {
    console.error("apply-tag ManyChat update failed:", e);
    return NextResponse.json(
      { error: "manychat_failed", detail: String(e) },
      { status: 502 }
    );
  }

  await db
    .update(escalations)
    .set({ tagAppliedAt: new Date() })
    .where(eq(escalations.id, id));

  return NextResponse.json({ ok: true });
}
