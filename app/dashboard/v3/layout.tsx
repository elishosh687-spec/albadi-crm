import { db } from "@/lib/db";
import { botDrafts, factoryQuoteRequests } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { Sidebar } from "./_components/Sidebar";
import { MobileMenu } from "./_components/MobileMenu";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function V3Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [pendingDraftsRows, factoryReceivedRows] = await Promise.all([
    db
      .select({ id: botDrafts.id })
      .from(botDrafts)
      .where(eq(botDrafts.status, "pending")),
    db
      .select({ id: factoryQuoteRequests.id })
      .from(factoryQuoteRequests)
      .where(eq(factoryQuoteRequests.factoryStatus, "received")),
  ]);

  return (
    <div className="dark min-h-dvh bg-background text-foreground" dir="rtl">
      <div className="flex min-h-dvh">
        <Sidebar
          pendingDrafts={pendingDraftsRows.length}
          factoryReceived={factoryReceivedRows.length}
        />
        <MobileMenu
          pendingDrafts={pendingDraftsRows.length}
          factoryReceived={factoryReceivedRows.length}
        />
        <main className="flex-1 min-w-0 p-4 md:p-8 max-w-[1600px] pt-16 md:pt-8">
          {children}
        </main>
      </div>
    </div>
  );
}
