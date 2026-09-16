import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Mirrors web-next/lib/outbound-fetch.ts: strip tracing headers, then fetch.
 * The source-contract test in observability.test.ts asserts the real module
 * never calls getTraceData or sets those headers.
 */
async function outboundFetchForTest(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  for (const name of ["sentry-trace", "baggage", "traceparent", "tracestate"]) {
    headers.delete(name);
  }
  return fetch(url, { ...init, headers, cache: "no-store" });
}

test("outboundFetch-equivalent RequestInit has no tracing headers", async () => {
  const seen: Headers[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Headers(init?.headers));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await outboundFetchForTest("http://python-direct:8001/api/success", {
      headers: {
        accept: "application/json",
        "sentry-trace": "should-be-stripped",
        baggage: "should-be-stripped",
        traceparent: "should-be-stripped",
      },
    });
  } finally {
    globalThis.fetch = original;
  }

  assert.equal(seen.length, 1);
  assert.equal(seen[0].get("sentry-trace"), null);
  assert.equal(seen[0].get("baggage"), null);
  assert.equal(seen[0].get("traceparent"), null);
  assert.equal(seen[0].get("tracestate"), null);
  assert.equal(seen[0].get("accept"), "application/json");
});
