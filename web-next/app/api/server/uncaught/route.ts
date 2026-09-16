import * as Sentry from "@sentry/nextjs";
import { recordRequestMetrics } from "@/lib/observability";

export const dynamic = "force-dynamic";

export async function GET() {
  Sentry.setAttribute("test_case", "next-server-uncaught");
  recordRequestMetrics("next-server-uncaught", 0, true);
  throw new Error("Uncaught Next.js server exception for Sentry PoC");
}
