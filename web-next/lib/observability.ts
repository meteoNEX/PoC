import * as Sentry from "@sentry/nextjs";
import { pocEnvironment, pocRelease } from "./release";
import { TRACE_PROPAGATION_TARGETS } from "./trace-propagation-targets";
import { describeHop, hierarchyFromProxyBody, parseSentryTrace } from "./trace-hierarchy";

export const SERVICE = "sentry-poc-next";
export { describeHop, hierarchyFromProxyBody, parseSentryTrace };

function spanIds(span: ReturnType<typeof Sentry.getActiveSpan>) {
  if (!span) return null;
  const json = Sentry.spanToJSON(span);
  return {
    trace_id: json.trace_id,
    span_id: json.span_id,
    parent_span_id: json.parent_span_id ?? null,
    op: json.op ?? null,
    description: json.description ?? null,
  };
}

export function currentTraceDebug() {
  const active = Sentry.getActiveSpan();
  const root = active ? Sentry.getRootSpan(active) : undefined;
  return {
    note: "These are SDK helper snapshots on the Next.js server span. They are NOT the headers that fetch() sent. Use downstream incoming_trace_headers for the wire. getTraceData() omits traceparent unless { propagateTraceparent: true } is passed; that is unrelated to native fetch instrumentation.",
    getTraceData_default: Sentry.getTraceData(),
    getTraceData_propagateTraceparent: Sentry.getTraceData({ propagateTraceparent: true }),
    activeSpan: (() => {
      const ctx = active?.spanContext();
      return ctx ? { traceId: ctx.traceId, spanId: ctx.spanId } : null;
    })(),
    active_span: spanIds(active),
    root_span: spanIds(root),
    environment: pocEnvironment(),
    release: pocRelease() ?? null,
    tracePropagationTargets: TRACE_PROPAGATION_TARGETS.map(String),
  };
}

/**
 * Diagnostic-only: read tracing headers the browser actually sent, and compare
 * them to the Next.js **root** http.server span. Does not set or overwrite
 * sentry-trace / baggage / traceparent.
 *
 * Compare against the root server span, not `getActiveSpan()`. The active span
 * inside a route handler is often `executing api route`, whose parent is the
 * Next.js http.server span — not the browser http.client span.
 */
export function browserIncomingTraceDebug(request: Request) {
  const sentryTrace = request.headers.get("sentry-trace");
  const baggage = request.headers.get("baggage");
  const traceparent = request.headers.get("traceparent");
  const active = Sentry.getActiveSpan();
  const root = active ? Sentry.getRootSpan(active) : undefined;
  const rootIds = spanIds(root);
  return {
    incoming_browser_headers: {
      "sentry-trace": sentryTrace,
      baggage,
      traceparent,
    },
    next_active_span: spanIds(active),
    next_root_span: rootIds,
    browser_to_next_hop: describeHop("browser-http-client → next-http-server", sentryTrace, rootIds),
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
