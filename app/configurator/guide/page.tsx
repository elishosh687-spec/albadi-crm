import React from "react";
import Link from "next/link";
import { colors, fontStack, radius, space, weight } from "@/lib/ui/tokens";

export const metadata = {
  title: "מדריך מעצב 3D | Albadi",
};

const linkStyle = (primary = false): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: space.sm,
  padding: `${space.sm}px ${space.lg}px`,
  borderRadius: radius.md,
  border: primary ? "none" : `1px solid ${colors.rule}`,
  background: primary ? colors.accent : colors.surface,
  color: primary ? colors.surface : colors.ink,
  fontWeight: weight.medium,
  textDecoration: "none",
});

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
          maxWidth: 680,
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
            מסירה ללקוח, בדיקה מקומית, ושליחת מעצב 3D מ-CRM
          </p>
        </div>

        <section>
          <h2
            style={{
              fontFamily: fontStack.display,
              fontSize: 16,
              fontWeight: weight.medium,
              margin: `0 0 ${space.sm}px`,
              color: colors.ink,
            }}
          >
            מסמך מסירה ללקוח (Handover)
          </h2>
          <p style={{ fontSize: 14, color: colors.inkMuted, margin: `0 0 ${space.md}px` }}>
            דוח מלא: מעצב 3D, CRM, WhatsApp, וכל מה שנבנה — בעיצוב Paper &amp; Ink של המערכת.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: space.md }}>
            <a href="/docs/CLIENT-HANDOVER.pdf" download style={linkStyle(true)}>
              Client Handover PDF
            </a>
            <a
              href="/docs/CLIENT-HANDOVER.html"
              target="_blank"
              rel="noopener noreferrer"
              style={linkStyle()}
            >
              Open handover (HTML)
            </a>
          </div>
        </section>

        <section>
          <h2
            style={{
              fontFamily: fontStack.display,
              fontSize: 16,
              fontWeight: weight.medium,
              margin: `0 0 ${space.sm}px`,
              color: colors.ink,
            }}
          >
            מסמכים נוספים
          </h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: space.md }}>
            <a href="/docs/CONFIGURATOR-GUIDE.pdf" download style={linkStyle()}>
              מדריך PDF (עברית)
            </a>
            <a
              href="/docs/configurator-guide.html"
              target="_blank"
              rel="noopener noreferrer"
              style={linkStyle()}
            >
              מדריך HTML
            </a>
            <Link href="/configurator" style={linkStyle()}>
              פתח מעצב 3D
            </Link>
          </div>
        </section>

        <section style={{ fontSize: 14, color: colors.ink, lineHeight: 1.6 }}>
          <h2
            style={{
              fontFamily: fontStack.display,
              fontSize: 16,
              margin: `0 0 ${space.sm}px`,
            }}
          >
            בדיקה מקומית
          </h2>
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
            <li>
              <strong>רענון PDF:</strong>{" "}
              <code style={{ direction: "ltr" }}>pnpm docs:handover</code>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
