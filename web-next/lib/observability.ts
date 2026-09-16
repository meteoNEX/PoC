import * as Sentry from "@sentry/nextjs";

export const SERVICE = "sentry-poc-next";

export function currentTraceDebug() {
  const span = Sentry.getActiveSpan();
  const spanContext = span?.spanContext();
  return {
    sentryTraceData: Sentry.getTraceData(),
    activeSpan: spanContext
      ? {
          traceId: spanContext.traceId,
          spanId: spanContext.spanId,
        }
      : null,
  };
}

export function recordRequestMetrics(testCase: string, durationMs: number, failed = false) {
  const attributes = {
    service: SERVICE,
    environment: process.env.SENTRY_ENVIRONMENT ?? "poc",
    test_case: testCase,
    request_kind: "http",
  };
  Sentry.metrics.count("poc.request.count", 1, { attributes });
  Sentry.metrics.distribution("poc.request.duration", durationMs, {
    unit: "millisecond",
    attributes,
  });
  Sentry.metrics.gauge("poc.queue.depth", 1, { attributes });
  if (failed) {
    Sentry.metrics.count("poc.failure.count", 1, { attributes });
  }
}

export function structuredLog(
  level: "info" | "warn" | "error",
  message: string,
  testCase: string,
) {
  const attributes = {
    service: SERVICE,
    environment: process.env.SENTRY_ENVIRONMENT ?? "poc",
    test_case: testCase,
    request_kind: "log",
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
