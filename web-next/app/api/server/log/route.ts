import * as Sentry from "@sentry/nextjs";
import {
  currentTraceDebug,
  recordRequestMetrics,
  structuredLog,
} from "@/lib/observability";

export const dynamic = "force-dynamic";

export async function GET() {
  Sentry.setAttribute("test_case", "next-server-log");
  structuredLog(
    "info",
    "Next.js server structured log correlated with the active trace",
    "next-server-log",
  );
  recordRequestMetrics("next-server-log", 1);
  return Response.json({
    ok: true,
    service: "sentry-poc-next",
    test_case: "next-server-log",
    trace: currentTraceDebug(),
  });
}
