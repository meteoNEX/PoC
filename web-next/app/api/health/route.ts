import { currentTraceDebug, recordRequestMetrics } from "@/lib/observability";

export const dynamic = "force-dynamic";

export async function GET() {
  recordRequestMetrics("next-health", 1);
  return Response.json({
    ok: true,
    service: "sentry-poc-next",
    trace: currentTraceDebug(),
  });
}
