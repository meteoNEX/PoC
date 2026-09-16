/**
 * Local parent/child evidence from sentry-trace + downstream span ids.
 * Pure helpers — no Sentry SDK calls.
 */

export function parseSentryTrace(header?: string | null) {
  if (!header) {
    return null;
  }
  const match = header.trim().match(/^([0-9a-f]{32})-([0-9a-f]{16})-([01])$/i);
  if (!match) {
    return null;
  }
  return {
    trace_id: match[1].toLowerCase(),
    span_id: match[2].toLowerCase(),
    sampled: match[3] === "1",
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function nested(obj: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  if (!obj) return null;
  return asRecord(obj[key]);
}

function str(obj: Record<string, unknown> | null, key: string): string | null {
  const value = obj?.[key];
  return typeof value === "string" ? value : null;
}

export function describeHop(
  label: string,
  incomingSentryTrace: string | null | undefined,
  downstreamSpan: Record<string, unknown> | null,
) {
  const incoming = parseSentryTrace(incomingSentryTrace);
  const downstreamTraceId = str(downstreamSpan, "trace_id");
  const downstreamSpanId = str(downstreamSpan, "span_id");
  const downstreamParent =
    str(downstreamSpan, "parent_span_id") ?? str(downstreamSpan, "transaction_parent_span_id");
  return {
    hop: label,
    incoming_http_client_span_from_sentry_trace: incoming,
    downstream_span: {
      trace_id: downstreamTraceId,
      span_id: downstreamSpanId,
      parent_span_id: str(downstreamSpan, "parent_span_id"),
      transaction_parent_span_id: str(downstreamSpan, "transaction_parent_span_id"),
    },
    same_trace_id: Boolean(
      incoming && downstreamTraceId && incoming.trace_id === downstreamTraceId.toLowerCase(),
    ),
    parent_child_matches_incoming_span: Boolean(
      incoming && downstreamParent && incoming.span_id === downstreamParent.toLowerCase(),
    ),
  };
}

export function hierarchyFromProxyBody(downstreamBody: unknown) {
  const body = asRecord(downstreamBody);
  const incoming = nested(body, "incoming_trace_headers");
  const pythonOrSpring = nested(body, "active_span");
  const pythonViaSpring = nested(body, "downstream");
  const hops = [
    describeHop(
      "next-http-client → immediate-downstream",
      str(incoming, "sentry-trace"),
      pythonOrSpring,
    ),
  ];
  if (pythonViaSpring) {
    hops.push(
      describeHop(
        "spring-http-client → python-downstream",
        str(nested(pythonViaSpring, "incoming_trace_headers"), "sentry-trace"),
        nested(pythonViaSpring, "active_span"),
      ),
    );
  }
  return hops;
}
