import { redirect } from "next/navigation";

// Root path goes straight to the live dashboard. The middleware (middleware.ts)
// gates /dashboard/* on the albadi_auth cookie, so unauthenticated visitors
// get bounced to /login automatically.
export default function Home() {
  redirect("/dashboard/v3");
}
