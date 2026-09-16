import * as Sentry from "@sentry/nextjs";
import { currentTraceDebug, recordRequestMetrics } from "@/lib/observability";

export const dynamic = "force-dynamic";

export async function GET() {
  Sentry.setAttribute("test_case", "next-server-caught");
  try {
    throw new Error("Caught Next.js server exception for Sentry PoC");
  } catch (error) {
    Sentry.captureException(error);
    recordRequestMetrics("next-server-caught", 1, true);
    return Response.json({
      ok: false,
      captured: true,
      service: "sentry-poc-next",
      test_case: "next-server-caught",
      trace: currentTraceDebug(),
    });
  }
}
