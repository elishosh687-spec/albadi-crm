/** @type {import('next').NextConfig} */
// Strip stray UTF-8 BOM that PowerShell stdin pipes prepend when running
// `vercel env add` on Windows. The BOM breaks strict CSP parsers in browsers.
const BOM = "﻿";
const stripBom = (s) => (typeof s === "string" && s.startsWith(BOM) ? s.slice(1) : s);
const WIDGET_FRAME_ANCESTORS =
  stripBom(process.env.WIDGET_ALLOWED_FRAME_ANCESTORS) ||
  "https://app.gohighlevel.com https://*.leadconnectorhq.com https://*.gohighlevel.com https://*.msgsndr.com";

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        // Allow GHL (and other allowlisted hosts) to embed widget pages.
        // CSP frame-ancestors supersedes X-Frame-Options on modern browsers.
        // We do NOT set X-Frame-Options here so the CSP takes precedence.
        source: "/widget/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors 'self' ${WIDGET_FRAME_ANCESTORS}`,
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
