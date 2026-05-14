import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Public paths
  if (path === "/login" || path.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  // Public: customer-facing PDF download. The URL embeds a random ~8-char
  // id so it's not enumerable, and is the link we paste into WhatsApp for
  // the customer to open. GET-only so we don't expose any write surface.
  if (
    req.method === "GET" &&
    /^\/api\/factory\/[^/]+\/pdf$/.test(path)
  ) {
    return NextResponse.next();
  }

  // Protect dashboard + actions APIs + factory pipeline APIs
  if (
    path.startsWith("/dashboard") ||
    path.startsWith("/api/actions/") ||
    path.startsWith("/api/factory/")
  ) {
    const cookie = req.cookies.get("albadi_auth");
    if (!cookie || cookie.value !== process.env.ADMIN_PASSWORD) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("from", path);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/actions/:path*", "/api/factory/:path*"],
};
