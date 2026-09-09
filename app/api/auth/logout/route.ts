import { NextResponse } from "next/server";
import { withRequestLog } from "@/lib/observability/log";

export const POST = withRequestLog("auth", async () => {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("albadi_auth");
  return res;
});
