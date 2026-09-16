#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

DIRECT="http://127.0.0.1:${PYTHON_DIRECT_PORT:-8001}"
DOWNSTREAM="http://127.0.0.1:${PYTHON_DOWNSTREAM_PORT:-8002}"
SPRING="http://127.0.0.1:${SPRING_PORT:-8080}"
NEXT="http://127.0.0.1:${NEXT_PORT:-3000}"

fail=0
check() {
  local name="$1"
  local url="$2"
  local expect="$3"
  local code
  code="$(curl -sS -o /tmp/sentry-poc-smoke.json -w "%{http_code}" "$url" || true)"
  if [[ "$code" == "$expect" ]]; then
    echo "PASS  $name  $code  $url"
  else
    echo "FAIL  $name  got $code expected $expect  $url"
    fail=1
  fi
}

echo "=== health ==="
check "python-direct health" "$DIRECT/health" 200
check "python-downstream health" "$DOWNSTREAM/health" 200
check "spring health" "$SPRING/health" 200
check "next health" "$NEXT/api/health" 200

echo "=== success routes ==="
check "python-direct success" "$DIRECT/api/success" 200
check "python-downstream success" "$DOWNSTREAM/api/success" 200
check "spring success" "$SPRING/api/success" 200
check "spring downstream success" "$SPRING/api/downstream-success" 200
check "next → python direct" "$NEXT/api/proxy/python-direct?mode=success" 200
check "next → spring → python" "$NEXT/api/proxy/spring?mode=downstream-success" 200

echo "=== logs / metrics ==="
check "python-direct log" "$DIRECT/api/log" 200
check "python-downstream log" "$DOWNSTREAM/api/log" 200
check "spring log" "$SPRING/api/log" 200
check "spring → python-downstream log" "$SPRING/api/downstream-log" 200
check "next → python-direct log" "$NEXT/api/proxy/python-direct?mode=log" 200
check "next → spring → python-downstream log" "$NEXT/api/proxy/spring?mode=downstream-log" 200
check "python-direct metric" "$DIRECT/api/metric" 200
check "spring metric" "$SPRING/api/metric" 200
check "next server log" "$NEXT/api/server/log" 200
check "next traceparent helper snapshot" "$NEXT/api/server/traceparent-helper-snapshot" 200

echo "=== designed failures ==="
check "python-direct error" "$DIRECT/api/error" 500
check "python-downstream error" "$DOWNSTREAM/api/error" 500
check "spring error" "$SPRING/api/error" 500
check "next server uncaught" "$NEXT/api/server/uncaught" 500
check "next server caught" "$NEXT/api/server/caught" 200
check "next → python-direct error" "$NEXT/api/proxy/python-direct?mode=error" 500
check "next → spring error" "$NEXT/api/proxy/spring?mode=error" 500
check "next → python-downstream error" "$NEXT/api/proxy/spring?mode=downstream-error" 500

echo "=== uptime endpoint ==="
check "uptime normal" "$SPRING/api/uptime-test" 200
check "uptime error" "$SPRING/api/uptime-test?mode=error" 500
check "next → uptime normal" "$NEXT/api/proxy/spring?mode=uptime" 200
check "next → uptime error" "$NEXT/api/proxy/spring?mode=uptime-error" 500

echo "=== span hierarchy (parent_span_id, not only trace_id) ==="
if python3 "$ROOT/scripts/assert-trace-hierarchy.py" \
  "$NEXT/api/proxy/python-direct?mode=success" \
  "Browser-equivalent Next → Python Direct"; then
  echo "PASS  hierarchy python-direct"
else
  echo "FAIL  hierarchy python-direct"
  fail=1
fi
if python3 "$ROOT/scripts/assert-trace-hierarchy.py" \
  "$NEXT/api/proxy/spring?mode=downstream-success" \
  "Browser-equivalent Next → Spring → Python Downstream"; then
  echo "PASS  hierarchy spring-downstream"
else
  echo "FAIL  hierarchy spring-downstream"
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  echo "Smoke tests failed."
  exit 1
fi
echo "Smoke tests passed."
