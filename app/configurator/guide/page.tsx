import React from "react";
import Link from "next/link";
import { colors, fontStack, radius, space, weight } from "@/lib/ui/tokens";

export const metadata = {
  title: "מדריך מעצב 3D | Albadi",
};

export default function ConfiguratorGuidePage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: colors.surfaceMuted,
        fontFamily: fontStack.body,
        padding: space.xl,
      }}
    >
      <div
        style={{
          maxWidth: 640,
          margin: "0 auto",
          background: colors.surface,
          borderRadius: radius.lg,
          border: `1px solid ${colors.rule}`,
          padding: space.xl,
          display: "flex",
          flexDirection: "column",
          gap: space.lg,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontFamily: fontStack.display,
              fontSize: 28,
              fontWeight: weight.medium,
              color: colors.accent,
            }}
          >
            מדריך מעצב שקיות 3D
          </h1>
          <p style={{ margin: `${space.sm}px 0 0`, color: colors.inkMuted }}>
            מה הושלם, איך לבדוק מקומית, ואיך לשלוח ללקוח מ-CRM
          </p>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: space.md }}>
          <a
            href="/docs/CLIENT-DELIVERY-EN.pdf"
            download
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: space.sm,
              padding: `${space.sm}px ${space.lg}px`,
              borderRadius: radius.md,
              background: colors.accent,
              color: colors.surface,
              fontWeight: weight.medium,
              textDecoration: "none",
            }}
          >
            Client PDF (EN)
          </a>
          <a
            href="/docs/CLIENT-DELIVERY-EN.html"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: space.sm,
              padding: `${space.sm}px ${space.lg}px`,
              borderRadius: radius.md,
              border: `1px solid ${colors.rule}`,
              color: colors.ink,
              textDecoration: "none",
            }}
          >
            Client report (EN)
          </a>
          <a
            href="/docs/CONFIGURATOR-GUIDE.pdf"
            download
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: space.sm,
              padding: `${space.sm}px ${space.lg}px`,
              borderRadius: radius.md,
              border: `1px solid ${colors.rule}`,
              color: colors.ink,
              textDecoration: "none",
            }}
          >
            מדריך PDF (עברית)
          </a>
          <a
            href="/docs/configurator-guide.html"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: space.sm,
              padding: `${space.sm}px ${space.lg}px`,
              borderRadius: radius.md,
              border: `1px solid ${colors.rule}`,
              color: colors.ink,
              textDecoration: "none",
            }}
          >
            פתח מדריך HTML (הדפסה)
          </a>
          <Link
            href="/configurator"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: space.sm,
              padding: `${space.sm}px ${space.lg}px`,
              borderRadius: radius.md,
              border: `1px solid ${colors.rule}`,
              color: colors.ink,
              textDecoration: "none",
            }}
          >
            פתח מעצב 3D
          </Link>
        </div>

        <section style={{ fontSize: 14, color: colors.ink, lineHeight: 1.6 }}>
          <h2 style={{ fontSize: 16, margin: `0 0 ${space.sm}px` }}>בדיקה מקומית</h2>
          <ul style={{ margin: 0, paddingRight: 20 }}>
            <li>
              <strong>CRM + מעצב:</strong>{" "}
              <code style={{ direction: "ltr" }}>localhost:3000/configurator</code>
            </li>
            <li>
              <strong>Dashboard:</strong>{" "}
              <code style={{ direction: "ltr" }}>localhost:3000/dashboard/v3</code>
            </li>
            <li>
              <strong>אתר (iframe):</strong>{" "}
              <code style={{ direction: "ltr" }}>localhost:8081/configurator</code>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
