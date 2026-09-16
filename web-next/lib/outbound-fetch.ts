import * as Sentry from "@sentry/nextjs";

export type OutboundFetchResult = {
  response: Response;
  outgoingTraceHeaders: Record<string, string>;
  sdkTraceData: Record<string, string>;
  w3cTraceparentSource: "sdk-header" | "derived-from-sentry-trace" | "missing";
};

/**
 * Map Sentry's `sentry-trace` header to a W3C `traceparent`.
 *
 * Format (Sentry): `{trace_id}-{span_id}-{sampled}`
 * Format (W3C):    `00-{trace_id}-{span_id}-{00|01}`
 *
 * This is the same mapping the JS SDK uses when `propagateTraceparent: true`.
 * We apply it here because @sentry/nextjs 10.75.0's server `fetch` +
 * `Sentry.getTraceData()` attached sentry-trace and baggage, but not
 * traceparent, even with `propagateTraceparent: true`.
 */
function traceparentFromSentryTrace(sentryTrace: string): string | null {
  const match = sentryTrace.trim().match(/^([0-9a-f]{32})-([0-9a-f]{16})-([01])$/i);
  if (!match) {
    return null;
  }
  return `00-${match[1]}-${match[2]}-0${match[3]}`;
}

/**
 * Inspectable outbound fetch used by Next.js route handlers.
 *
 * Why this file exists:
 * A previous OpenTelemetry PoC lost the trace at the Next.js outbound fetch
 * boundary. This wrapper makes the hop easy to audit.
 *
 * What is official Sentry instrumentation vs explicit:
 * - Native `fetch` is automatically patched by @sentry/nextjs.
 * - `tracePropagationTargets` + `propagateTraceparent: true` tell the SDK to
 *   attach sentry-trace, baggage, and W3C traceparent.
 * - `Sentry.getTraceData()` is the official SDK helper for the current
 *   sentry-trace / baggage pair. We merge it onto the request so a Next.js
 *   fetch cache/patch cannot silently drop the Sentry headers.
 * - W3C `traceparent` is added from sentry-trace when the SDK did not attach it.
 *
 * We do not invent span IDs. Trace and span ids always come from the SDK.
 */
export async function outboundFetch(
  url: string,
  init: RequestInit = {},
): Promise<OutboundFetchResult> {
  const sdkTraceData = Sentry.getTraceData();
  const headers = new Headers(init.headers);

  for (const [key, value] of Object.entries(sdkTraceData)) {
    if (value && !headers.has(key)) {
      headers.set(key, String(value));
    }
  }

  let w3cTraceparentSource: OutboundFetchResult["w3cTraceparentSource"] = "missing";
  if (headers.get("traceparent")) {
    w3cTraceparentSource = "sdk-header";
  } else {
    const sentryTrace = headers.get("sentry-trace");
    const derived = sentryTrace ? traceparentFromSentryTrace(sentryTrace) : null;
    if (derived) {
      headers.set("traceparent", derived);
      w3cTraceparentSource = "derived-from-sentry-trace";
    }
  }

  const outgoingTraceHeaders: Record<string, string> = {};
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (
      lower === "sentry-trace" ||
      lower === "baggage" ||
      lower === "traceparent" ||
      lower === "tracestate"
    ) {
      outgoingTraceHeaders[lower] = value;
    }
  });

  const response = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
  });

  return {
    response,
    outgoingTraceHeaders,
    sdkTraceData: Object.fromEntries(
      Object.entries(sdkTraceData).map(([key, value]) => [key, String(value)]),
    ),
    w3cTraceparentSource,
  };
}

export function pythonDirectBaseUrl() {
  return process.env.PYTHON_DIRECT_BASE_URL ?? "http://127.0.0.1:8001";
}

export function springBaseUrl() {
  return process.env.SPRING_BASE_URL ?? "http://127.0.0.1:8080";
}
