import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { escalations } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { getSubscriber, setCustomFields, getFieldValue } from "@/lib/manychat/client";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    id: number;
    action: "resolve" | "dismiss";
    note?: string;
    chosenOptionIndex?: number;
  };
  const { id, action, note, chosenOptionIndex } = body;

  if (!id || !action) {
    return NextResponse.json({ error: "missing id or action" }, { status: 400 });
  }

  const [esc] = await db.select().from(escalations).where(eq(escalations.id, id));
  if (!esc) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await db
    .update(escalations)
    .set({
      resolvedAt: new Date(),
      resolutionNote: note ?? action,
      chosenOptionIndex: typeof chosenOptionIndex === "number" ? chosenOptionIndex : null,
    })
    .where(eq(escalations.id, id));

  if (
    typeof chosenOptionIndex === "number" &&
    esc.suggestedReplies &&
    esc.suggestedReplies[chosenOptionIndex]
  ) {
    const opt = esc.suggestedReplies[chosenOptionIndex];
    try {
      const sub = await getSubscriber(esc.manychatSubId);
      const currentNotes = String(getFieldValue(sub.custom_fields, "notes") ?? "");
      const date = new Date().toLocaleDateString("he-IL");
      const stamp = `[${date}] בחר אופציה: ${opt.label}`;
      const merged = currentNotes.includes(stamp)
        ? currentNotes
        : `${currentNotes}\n${stamp}`.trim().slice(0, 4000);
      await setCustomFields(esc.manychatSubId, [{ name: "notes", value: merged }]);
    } catch (e) {
      console.error("ManyChat notes update failed:", e);
    }
  }

  return NextResponse.json({ ok: true });
}
