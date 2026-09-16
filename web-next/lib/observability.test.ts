import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeHop, hierarchyFromProxyBody, parseSentryTrace } from "./trace-hierarchy.ts";
import { TRACE_PROPAGATION_TARGETS } from "./trace-propagation-targets.ts";

test("parseSentryTrace extracts trace_id, span_id, sampled", () => {
  const parsed = parseSentryTrace("1234567890abcdef1234567890abcdef-aaaabbbbccccdddd-1");
  assert.deepEqual(parsed, {
    trace_id: "1234567890abcdef1234567890abcdef",
    span_id: "aaaabbbbccccdddd",
    sampled: true,
  });
});

test("describeHop requires parent_span_id match, not only trace_id", () => {
  const hop = describeHop(
    "next-http-client → python",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-1",
    {
      trace_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      span_id: "cccccccccccccccc",
      parent_span_id: "bbbbbbbbbbbbbbbb",
    },
  );
  assert.equal(hop.same_trace_id, true);
  assert.equal(hop.parent_child_matches_incoming_span, true);

  const sibling = describeHop(
    "broken sibling",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-1",
    {
      trace_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      span_id: "cccccccccccccccc",
      parent_span_id: "dddddddddddddddd",
    },
  );
  assert.equal(sibling.same_trace_id, true);
  assert.equal(sibling.parent_child_matches_incoming_span, false);
});

test("hierarchyFromProxyBody includes Spring → Python hop", () => {
  const hops = hierarchyFromProxyBody({
    incoming_trace_headers: {
      "sentry-trace": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-1111111111111111-1",
    },
    active_span: {
      trace_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      span_id: "2222222222222222",
      parent_span_id: "1111111111111111",
    },
    downstream: {
      incoming_trace_headers: {
        "sentry-trace": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-3333333333333333-1",
      },
      active_span: {
        trace_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        span_id: "4444444444444444",
        parent_span_id: "3333333333333333",
      },
    },
  });
  assert.equal(hops.length, 2);
  assert.equal(hops[0].parent_child_matches_incoming_span, true);
  assert.equal(hops[1].parent_child_matches_incoming_span, true);
});

test("tracePropagationTargets cover native localhost and Docker DNS names", () => {
  const asStrings = TRACE_PROPAGATION_TARGETS.map(String);
  for (const needed of ["localhost", "127.0.0.1", "python-direct", "spring", "python-downstream"]) {
    assert.equal(asStrings.includes(needed), true, `missing target ${needed}`);
  }
});

test("outbound-fetch source does not pre-inject tracing headers", () => {
  const raw = readFileSync(new URL("./outbound-fetch.ts", import.meta.url), "utf8");
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(src, /headers\.delete\(name\)/);
  assert.equal(/Sentry\.getTraceData\s*\(/.test(src), false);
  assert.equal(/headers\.set\(\s*["']sentry-trace["']/.test(src), false);
  assert.equal(/headers\.set\(\s*["']traceparent["']/.test(src), false);
  assert.equal(/headers\.set\(\s*["']baggage["']/.test(src), false);
});
