export const metadata = {
  title: "Albadi CRM",
  description: "Lead management bot for Albadi",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
