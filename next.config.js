/** @type {import('next').NextConfig} */
const WIDGET_FRAME_ANCESTORS =
  process.env.WIDGET_ALLOWED_FRAME_ANCESTORS ||
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
