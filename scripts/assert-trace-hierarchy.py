#!/usr/bin/env python3
"""Assert local parent-child evidence from a Next.js proxy JSON body.

This is not a Sentry UI tree. It checks:
- Next.js did not pre-inject tracing headers
- each hop shares trace_id
- downstream parent_span_id equals the incoming sentry-trace span_id
  (that span_id is the upstream HTTP client span if native instrumentation worked)
- Next.js route span id is different from the outgoing sentry-trace span id
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request


def parse_sentry_trace(header: str | None) -> tuple[str, str] | None:
    if not header:
        return None
    parts = header.strip().split("-")
    if len(parts) < 2:
        return None
    return parts[0].lower(), parts[1].lower()


def load(url: str) -> tuple[int, dict]:
    try:
        with urllib.request.urlopen(url, timeout=45) as resp:
            body = json.load(resp)
            return resp.status, body
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            return exc.code, json.loads(raw)
        except json.JSONDecodeError:
            print(f"HTTP {exc.code} non-JSON from {url}: {raw[:300]}", file=sys.stderr)
            raise


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: assert-trace-hierarchy.py URL [label]", file=sys.stderr)
        return 2
    url = sys.argv[1]
    label = sys.argv[2] if len(sys.argv) > 2 else url
    status, body = load(url)
    print(f"=== {label}  HTTP {status} ===")
    if body.get("headers_injected_by_next_before_fetch") is True:
        print("FAIL  Next.js still injected tracing headers before fetch()")
        return 1

    hops = body.get("span_hierarchy_local_evidence") or []
    if not hops:
        print("FAIL  missing span_hierarchy_local_evidence")
        print(json.dumps(body, indent=2)[:2000])
        return 1

    failed = 0
    for hop in hops:
        name = hop.get("hop")
        same = hop.get("same_trace_id")
        parent = hop.get("parent_child_matches_incoming_span")
        incoming = hop.get("incoming_http_client_span_from_sentry_trace") or {}
        down = hop.get("downstream_span") or {}
        print(
            f"  hop={name} same_trace_id={same} parent_child={parent} "
            f"incoming_span={incoming.get('span_id')} parent_span_id={down.get('parent_span_id')}"
        )
        if not same:
            print(f"FAIL  {name}: trace_id mismatch")
            failed = 1
        if not incoming:
            print(f"FAIL  {name}: downstream did not receive sentry-trace")
            failed = 1
        if not parent:
            print(
                f"FAIL  {name}: parent_span_id does not match incoming sentry-trace span_id "
                "(HTTP client span is not the parent of the downstream server span)"
            )
            failed = 1

    next_span = ((body.get("next_trace") or {}).get("activeSpan") or {}).get("spanId")
    first_incoming = (hops[0].get("incoming_http_client_span_from_sentry_trace") or {}).get("span_id")
    if next_span and first_incoming:
        if next_span.lower() == first_incoming.lower():
            print(
                "FAIL  Next.js active (route) span id equals outgoing sentry-trace span id; "
                "downstream is parented to the route span instead of the HTTP client span"
            )
            failed = 1
        else:
            print(
                f"  next_route_span={next_span} outbound_sentry_trace_span={first_incoming} "
                "(distinct — HTTP client span is not the route span)"
            )

    observed = body.get("observed_undici_headers") or {}
    downstream_headers = (
        (body.get("downstream_body") or {}).get("incoming_trace_headers")
        if isinstance(body.get("downstream_body"), dict)
        else {}
    )
    print(f"  observed_undici_headers={observed}")
    print(f"  downstream_incoming_trace_headers={downstream_headers}")
    wire_keys = [k for k, v in (downstream_headers or {}).items() if v]
    print(f"  native_fetch_headers_received={wire_keys}")

    if failed:
        print(f"FAIL  {label}")
        return 1
    print(f"PASS  {label}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
