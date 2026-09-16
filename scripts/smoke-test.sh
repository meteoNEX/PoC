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

echo "=== designed failures ==="
check "python-direct error" "$DIRECT/api/error" 500
check "python-downstream error" "$DOWNSTREAM/api/error" 500
check "spring error" "$SPRING/api/error" 500
check "next server uncaught" "$NEXT/api/server/uncaught" 500
check "next server caught" "$NEXT/api/server/caught" 200

if [[ "$fail" -ne 0 ]]; then
  echo "Smoke tests failed."
  exit 1
fi
echo "Smoke tests passed."
