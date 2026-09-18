import { NextRequest, NextResponse } from "next/server";

// PowerShell stdin pipes prepend a UTF-8 BOM on Windows when piping values
// into `vercel env add`. Without stripping, equality comparisons against
// user-supplied query string values silently fail.
const BOM = "﻿";
function stripBom(s: string | undefined): string | undefined {
  if (typeof s !== "string") return s;
  return s.startsWith(BOM) ? s.slice(1) : s;
}

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
  // ⚠️ refit-estimator was MISSING from this list from 2026-06-24 to
  // 2026-09-09: Vercel's daily cron GET got a 307 to /login and the estimator
  // ran on June coefficients for 2.5 months with no error anywhere. Any new
  // bearer-authed job under /api/factory/ must be added here too (the route's
  // own auth still runs after this).
  const cronBearers = [process.env.CRON_SECRET, process.env.BOT_SECRET, process.env.CALL_TRIGGER_SECRET]
    .filter(Boolean)
    .map((s) => `Bearer ${s}`);
  if (
    (path === "/api/factory/refresh" || path === "/api/factory/test-dm" || path === "/api/factory/refit-estimator") &&
    (req.method === "GET" || req.method === "POST") &&
    cronBearers.includes(req.headers.get("authorization") ?? "")
  ) {
    return NextResponse.next();
  }

  // GHL iframe widgets — anything under /widget/* or /api/widget/* is
  // public and auth'd by GHL_WIDGET_TOKEN inside route handlers.
  if (path.startsWith("/widget") || path.startsWith("/api/widget")) {
    return NextResponse.next();
  }

  // Widgets calling /api/factory/* need a backdoor — accept
  // ?widget_token=<value> matching GHL_WIDGET_TOKEN. All methods now
  // allowed (DELETE/POST too) so the Quotes History widget can delete
  // rows and send WhatsApp PDFs from inside the GHL iframe.
  const widgetTokenQuery = req.nextUrl.searchParams.get("widget_token");
  const expectedWidgetToken = stripBom(process.env.GHL_WIDGET_TOKEN);
  if (
    expectedWidgetToken &&
    widgetTokenQuery === expectedWidgetToken &&
    path.startsWith("/api/factory/")
  ) {
    return NextResponse.next();
  }

  // Protect the standalone Hub, legacy dashboard URLs, actions APIs, and the
  // factory pipeline. The standalone Hub uses the same UI as the GHL widget.
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
      url.searchParams.set("from", `${path}${req.nextUrl.search}`);
      return NextResponse.redirect(url);
    }
  }

  // The old dashboard is no longer a separate product. Keep its URLs as
  // compatibility aliases that land on the matching canonical Hub tab.
  if (path.startsWith("/dashboard")) {
    const tab =
      path.includes("/drafts") ? "drafts" :
      path.includes("/factory") ? "factory" :
      path.includes("/calculator") ? "calc" :
      path.includes("/settings") ? "settings" :
      path.includes("/shipping") ? "shipping" :
      path.includes("/conversations") ? "inbox" :
      path.includes("/analysis") ||
      path.includes("/analytics") ||
      path.includes("/leads") ||
      path.includes("/pipeline") ||
      path.includes("/followups") ? "analytics" : null;
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    if (tab) url.searchParams.set("tab", tab);
    return NextResponse.redirect(url);
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
