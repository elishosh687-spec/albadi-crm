import { cookies } from "next/headers";
import {
  verifyAdminCookie,
  verifyWidgetToken,
} from "@/integrations/ghl/widget-auth";

/**
 * Authenticate a server-rendered widget page in either supported context:
 * GHL's query token or the standalone site's HTTP-only login cookie.
 */
export async function widgetPageAuthed(
  token: string | null | undefined
): Promise<boolean> {
  if (verifyWidgetToken(token)) return true;
  const cookieStore = await cookies();
  return verifyAdminCookie(cookieStore.get("albadi_auth")?.value);
}
