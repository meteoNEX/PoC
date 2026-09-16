import { currentTraceDebug, recordRequestMetrics } from "@/lib/observability";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  recordRequestMetrics("next-health", Date.now() - started);
  return Response.json({
    ok: true,
    service: "sentry-poc-next",
    trace: currentTraceDebug(),
  });
}
