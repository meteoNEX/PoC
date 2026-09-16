import * as Sentry from "@sentry/nextjs";
import {
  currentTraceDebug,
  recordRequestMetrics,
  structuredLog,
} from "@/lib/observability";

export const dynamic = "force-dynamic";

export async function GET() {
  Sentry.setAttribute("test_case", "next-server-log");
  const started = Date.now();
  structuredLog(
    "info",
    "Next.js server structured log correlated with the active trace",
    "next-server-log",
  );
  recordRequestMetrics("next-server-log", Date.now() - started);
  return Response.json({
    ok: true,
    service: "sentry-poc-next",
    test_case: "next-server-log",
    log_channel: "sentry.logger",
    log_note: "This is explicit Sentry.logger(), not Next.js / console logging.",
    trace: currentTraceDebug(),
  });
}
