/**
 * Next.js → backend outbound fetch for the two core distributed-trace hops:
 *
 *   Browser → Next.js → Python Direct
 *   Browser → Next.js → Spring Boot → Python Downstream
 *
 * Native `fetch` is patched by `@sentry/nextjs`. The SDK creates an HTTP client
 * span first, then attaches tracing headers from THAT span. Pre-setting
 * sentry-trace / baggage / traceparent before fetch() makes the downstream
 * server span parent the Next.js route span instead of the HTTP client span.
 *
 * This wrapper therefore:
 * - uses native fetch
 * - deletes any tracing headers the caller might have passed
 * - never injects sentry-trace, baggage, or traceparent
 * - disables Next.js fetch caching so the real HTTP request is instrumented
 *
 * Canonical wire proof: downstream `incoming_trace_headers`.
 * `Sentry.getTraceData()` snapshots are diagnostic only and are never copied
 * onto the request.
 */

import { observeUndiciTraceHeaders, type ObservedTraceHeaders } from "./observe-undici-headers";

export type OutboundFetchResult = {
  response: Response;
  headersInjectedByCaller: false;
  observedUndiciHeaders: ObservedTraceHeaders;
  observationNote: string;
};

export async function outboundFetch(
  url: string,
  init: RequestInit = {},
): Promise<OutboundFetchResult> {
  const headers = new Headers(init.headers);
  for (const name of ["sentry-trace", "baggage", "traceparent", "tracestate"]) {
    headers.delete(name);
  }

  const undiciObservation = observeUndiciTraceHeaders(url);

  const response = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
  });

  return {
    response,
    headersInjectedByCaller: false,
    observedUndiciHeaders: await undiciObservation,
    observationNote:
      "observedUndiciHeaders is a best-effort capture of headers as undici sent them after SDK instrumentation. Canonical proof is downstream incoming_trace_headers. These values were not injected by this wrapper.",
  };
}

export function pythonDirectBaseUrl() {
  return process.env.PYTHON_DIRECT_BASE_URL ?? "http://127.0.0.1:8001";
}

export function springBaseUrl() {
  return process.env.SPRING_BASE_URL ?? "http://127.0.0.1:8080";
}
