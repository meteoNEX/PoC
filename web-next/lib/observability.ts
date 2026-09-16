import * as Sentry from "@sentry/nextjs";
import { pocEnvironment, pocRelease } from "./release";
import { TRACE_PROPAGATION_TARGETS } from "./trace-propagation-targets";
import { describeHop, hierarchyFromProxyBody, parseSentryTrace } from "./trace-hierarchy";

export const SERVICE = "sentry-poc-next";
export { describeHop, hierarchyFromProxyBody, parseSentryTrace };

export function currentTraceDebug() {
  return {
    note: "These are SDK helper snapshots on the Next.js server span. They are NOT the headers that fetch() sent. Use downstream incoming_trace_headers for the wire. getTraceData() omits traceparent unless { propagateTraceparent: true } is passed; that is unrelated to native fetch instrumentation.",
    getTraceData_default: Sentry.getTraceData(),
    getTraceData_propagateTraceparent: Sentry.getTraceData({ propagateTraceparent: true }),
    activeSpan: (() => {
      const span = Sentry.getActiveSpan();
      const ctx = span?.spanContext();
      return ctx ? { traceId: ctx.traceId, spanId: ctx.spanId } : null;
    })(),
    environment: pocEnvironment(),
    release: pocRelease() ?? null,
    tracePropagationTargets: TRACE_PROPAGATION_TARGETS.map(String),
  };
}

export function recordRequestMetrics(testCase: string, durationMs: number, failed = false) {
  const environment = pocEnvironment();
  const attributes = {
    service: SERVICE,
    environment,
    test_case: testCase,
    request_kind: "http",
  };
  Sentry.metrics.count("poc.request.count", 1, { attributes });
  Sentry.metrics.distribution("poc.request.duration", durationMs, {
    unit: "millisecond",
    attributes: { ...attributes, measurement: "elapsed_wall_time" },
  });
  Sentry.metrics.gauge("poc.queue.depth", 1, {
    attributes: {
      ...attributes,
      synthetic_example: true,
      note: "no-real-queue",
    },
  });
  if (failed) {
    Sentry.metrics.count("poc.failure.count", 1, { attributes });
  }
}

export function structuredLog(level: "info" | "warn" | "error", message: string, testCase: string) {
  const attributes = {
    service: SERVICE,
    environment: pocEnvironment(),
    test_case: testCase,
    request_kind: "log",
    log_channel: "sentry.logger",
  };
  Sentry.logger[level](message, attributes);
}

export function jsonHeadersFromResponse(response: Response) {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (
      key.startsWith("x-sentry-poc-") ||
      key === "sentry-trace" ||
      key === "baggage" ||
      key === "traceparent"
    ) {
      headers[key] = value;
    }
  });
  return headers;
}
