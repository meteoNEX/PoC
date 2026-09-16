import * as Sentry from "@sentry/nextjs";
import { currentTraceDebug } from "@/lib/observability";

export const dynamic = "force-dynamic";

/**
 * DIAGNOSTIC ONLY — not a core distributed-trace hop.
 *
 * Distinguishes:
 *   A. Sentry.getTraceData() helper snapshots (this route)
 *   B. SDK native fetch instrumentation / actual network headers
 *
 * Core hops must never copy these values onto fetch().
 */
export async function GET() {
  Sentry.setAttribute("test_case", "next-traceparent-helper-snapshot");
  return Response.json({
    ok: true,
    diagnostic_only: true,
    not_a_core_hop: true,
    purpose:
      "Compare Sentry.getTraceData() with and without propagateTraceparent. This is NOT proof of what native fetch sends.",
    getTraceData_default: Sentry.getTraceData(),
    getTraceData_propagateTraceparent: Sentry.getTraceData({ propagateTraceparent: true }),
    next_trace: currentTraceDebug(),
  });
}
