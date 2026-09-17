import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function AnalysisPage() {
  redirect("/dashboard/v3/analytics?view=diagnosis");
}
