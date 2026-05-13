import { db } from "@/lib/db";
import { botDrafts } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { Sidebar } from "./_components/Sidebar";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function V3Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pending = await db
    .select({ id: botDrafts.id })
    .from(botDrafts)
    .where(eq(botDrafts.status, "pending"));

  return (
    <div className="dark min-h-dvh bg-background text-foreground" dir="rtl">
      <div className="flex min-h-dvh">
        <Sidebar pendingDrafts={pending.length} />
        <main className="flex-1 min-w-0 p-6 md:p-8 max-w-[1600px]">
          {children}
        </main>
      </div>
    </div>
  );
}
