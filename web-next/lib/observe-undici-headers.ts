/**
 * Best-effort observation of tracing headers on the actual Node undici request.
 *
 * This is NOT a pre-fetch snapshot of Sentry.getTraceData(). It listens for
 * undici's sendHeaders diagnostic, which fires after Sentry's fetch/undici
 * instrumentation has mutated the outbound request.
 *
 * Downstream `incoming_trace_headers` remains the canonical wire proof.
 */

export type ObservedTraceHeaders = {
  "sentry-trace": string | null;
  baggage: string | null;
  traceparent: string | null;
  tracestate: string | null;
};

const EMPTY: ObservedTraceHeaders = {
  "sentry-trace": null,
  baggage: null,
  traceparent: null,
  tracestate: null,
};

function extractFromUndiciHeaders(headers: unknown): ObservedTraceHeaders {
  const found: ObservedTraceHeaders = { ...EMPTY };
  const assign = (name: string, value: string) => {
    const key = name.toLowerCase();
    if (key === "sentry-trace") found["sentry-trace"] = value;
    if (key === "baggage") found.baggage = value;
    if (key === "traceparent") found.traceparent = value;
    if (key === "tracestate") found.tracestate = value;
  };

  if (Array.isArray(headers)) {
    for (let i = 0; i < headers.length - 1; i += 2) {
      assign(String(headers[i]), String(headers[i + 1] ?? ""));
    }
    return found;
  }
  if (typeof headers === "string") {
    for (const line of headers.split("\r\n")) {
      const colon = line.indexOf(":");
      if (colon === -1) continue;
      assign(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    }
    return found;
  }
  return found;
}

export function observeUndiciTraceHeaders(url: string): Promise<ObservedTraceHeaders> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return Promise.resolve({ ...EMPTY });
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: ObservedTraceHeaders) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    let unsubscribe: (() => void) | undefined;
    const cleanup = () => {
      try {
        unsubscribe?.();
      } catch {
        /* ignore */
      }
    };

    const timeout = setTimeout(() => finish({ ...EMPTY }), 4000);

    void import("node:diagnostics_channel")
      .then((diagnostics) => {
        const handler = (message: unknown) => {
          const record = message as { request?: { origin?: string; path?: string; headers?: unknown } };
          const request = record?.request;
          if (!request) return;
          const origin = String(request.origin ?? "");
          const path = String(request.path ?? "");
          const matchesHost = origin.includes(target.host) || origin.includes(target.hostname);
          const matchesPath = path.startsWith(target.pathname);
          if (!matchesHost && !matchesPath) return;
          clearTimeout(timeout);
          finish(extractFromUndiciHeaders(request.headers));
        };
        diagnostics.subscribe("undici:client:sendHeaders", handler);
        unsubscribe = () => {
          diagnostics.unsubscribe("undici:client:sendHeaders", handler);
          clearTimeout(timeout);
        };
      })
      .catch(() => {
        clearTimeout(timeout);
        finish({ ...EMPTY });
      });
  });
}
