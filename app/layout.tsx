import type { Viewport } from "next";
import { Frank_Ruhl_Libre, Heebo, Newsreader, Manrope } from "next/font/google";
import { colors, fontStack } from "@/lib/ui/tokens";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

const display = Frank_Ruhl_Libre({
  subsets: ["latin", "hebrew"],
  weight: ["500", "700"],
  variable: "--font-display",
  display: "swap",
});

const body = Heebo({
  subsets: ["latin", "hebrew"],
  weight: ["200", "300", "400", "500", "700"],
  variable: "--font-body",
  display: "swap",
});

// Editorial serif for the calculator's giant section numerals (I/II/III/IV)
// and quote title. Scoped to the calculator via the `.calc-lux` wrapper.
const editorialSerif = Newsreader({
  subsets: ["latin"],
  weight: ["200", "300", "400"],
  style: ["normal", "italic"],
  variable: "--font-editorial-serif",
  display: "swap",
});

// Latin small-caps labels ("SUMMARY", "USD→ILS") in the calculator re-skin.
const editorialSans = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-editorial-sans",
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
    <html lang="he" dir="rtl" className={`${display.variable} ${body.variable} ${editorialSerif.variable} ${editorialSans.variable}`}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: globalCss }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
