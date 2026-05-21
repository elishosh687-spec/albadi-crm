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

  // External cron + admin debug: GitHub Actions hits /api/factory/refresh
  // with Authorization: Bearer ${CRON_SECRET}. Same bearer also unlocks
  // /api/factory/test-dm for one-shot bridge sanity checks.
  if (
    (path === "/api/factory/refresh" || path === "/api/factory/test-dm") &&
    req.method === "GET" &&
    process.env.CRON_SECRET &&
    req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.next();
  }

  // GHL iframe widgets — anything under /widget/* or /api/widget/* is
  // public and auth'd by GHL_WIDGET_TOKEN inside route handlers.
  if (path.startsWith("/widget") || path.startsWith("/api/widget")) {
    return NextResponse.next();
  }

  // Widgets calling /api/factory/quote-preview need a backdoor — accept
  // ?widget_token=<value> matching GHL_WIDGET_TOKEN. GET only, no writes.
  const widgetTokenQuery = req.nextUrl.searchParams.get("widget_token");
  const expectedWidgetToken = process.env.GHL_WIDGET_TOKEN;
  if (
    expectedWidgetToken &&
    widgetTokenQuery === expectedWidgetToken &&
    req.method === "GET" &&
    path.startsWith("/api/factory/")
  ) {
    return NextResponse.next();
  }

  // Protect dashboard + actions APIs + factory pipeline APIs + the root
  // path (which we internally serve from /dashboard/v3 — see below).
  if (
    path === "/" ||
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

  // Serve the live dashboard at the root path without changing the URL bar.
  // Internal rewrite — keeps the address at "/", renders /dashboard/v3.
  if (path === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard/v3";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/dashboard/:path*",
    "/api/actions/:path*",
    "/api/factory/:path*",
    "/widget/:path*",
    "/api/widget/:path*",
  ],
};
