import { NextRequest, NextResponse } from "next/server";
import { withRequestLog } from "@/lib/observability/log";

export const POST = withRequestLog("auth", async (req: NextRequest, log) => {
  const body = (await req.json()) as { password?: string };
  const password = body?.password;

  if (!password) {
    return NextResponse.json({ error: "נא להזין סיסמה" }, { status: 400 });
  }

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    log.error("login.not_configured", undefined, { reason: "ADMIN_PASSWORD unset" });
    return NextResponse.json(
      { error: "ADMIN_PASSWORD לא הוגדר בשרת" },
      { status: 500 }
    );
  }

  if (password !== expected) {
    log.warn("login.rejected");
    return NextResponse.json({ error: "סיסמה שגויה" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("albadi_auth", expected, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  log.info("login.ok");
  return res;
});
