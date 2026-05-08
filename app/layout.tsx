import { Frank_Ruhl_Libre, Heebo } from "next/font/google";
import { colors, fontStack } from "@/lib/ui/tokens";

const display = Frank_Ruhl_Libre({
  subsets: ["latin", "hebrew"],
  weight: ["500", "700"],
  variable: "--font-display",
  display: "swap",
});

const body = Heebo({
  subsets: ["latin", "hebrew"],
  weight: ["400", "500", "700"],
  variable: "--font-body",
  display: "swap",
});

export const metadata = {
  title: "Albadi CRM",
  description: "Lead management for Albadi",
};

const globalCss = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: ${colors.paper};
    color: ${colors.ink};
    font-family: ${fontStack.body};
    font-size: 16px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  a { color: ${colors.accent}; text-decoration: none; transition: color 150ms; }
  a:hover { color: ${colors.accentHover}; }
  button { font-family: inherit; }
  input, textarea, select { font-family: inherit; color: inherit; }
  :focus-visible {
    outline: 2px solid ${colors.accent};
    outline-offset: 2px;
    border-radius: 2px;
  }
  ::selection { background: ${colors.accentSoft}; color: ${colors.ink}; }
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl" className={`${display.variable} ${body.variable}`}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: globalCss }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
