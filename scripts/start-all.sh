#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f "$ROOT/.env" ]]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  echo "Created .env from .env.example"
fi

set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a

mkdir -p "$ROOT/logs" "$ROOT/.pids"
cp "$ROOT/.env" "$ROOT/web-next/.env.local"

python_setup() {
  local dir="$1"
  if [[ ! -d "$dir/.venv" ]]; then
    python3 -m venv "$dir/.venv"
    "$dir/.venv/bin/pip" install --upgrade pip
    "$dir/.venv/bin/pip" install -r "$dir/requirements.txt"
  fi
}

python_setup "$ROOT/backend-python-direct"
python_setup "$ROOT/backend-python-downstream"

if [[ ! -d "$ROOT/web-next/node_modules" ]]; then
  (cd "$ROOT/web-next" && npm install)
fi

echo "Starting Python Direct on :${PYTHON_DIRECT_PORT:-8001}"
nohup "$ROOT/backend-python-direct/.venv/bin/uvicorn" app:app \
  --app-dir "$ROOT/backend-python-direct" \
  --host 127.0.0.1 --port "${PYTHON_DIRECT_PORT:-8001}" \
  > "$ROOT/logs/python-direct.log" 2>&1 &
echo $! > "$ROOT/.pids/python-direct.pid"

echo "Starting Python Downstream on :${PYTHON_DOWNSTREAM_PORT:-8002}"
nohup "$ROOT/backend-python-downstream/.venv/bin/uvicorn" app:app \
  --app-dir "$ROOT/backend-python-downstream" \
  --host 127.0.0.1 --port "${PYTHON_DOWNSTREAM_PORT:-8002}" \
  > "$ROOT/logs/python-downstream.log" 2>&1 &
echo $! > "$ROOT/.pids/python-downstream.pid"

echo "Starting Spring Boot on :${SPRING_PORT:-8080}"
nohup mvn -f "$ROOT/backend-spring/pom.xml" spring-boot:run \
  > "$ROOT/logs/spring.log" 2>&1 &
echo $! > "$ROOT/.pids/spring.pid"

echo "Starting Next.js on :${NEXT_PORT:-3000}"
nohup npm --prefix "$ROOT/web-next" run dev -- --port "${NEXT_PORT:-3000}" \
  > "$ROOT/logs/next.log" 2>&1 &
echo $! > "$ROOT/.pids/next.pid"

echo
echo "Waiting for health endpoints..."
wait_for() {
  local url="$1"
  local name="$2"
  for _ in $(seq 1 90); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "  $name is up"
      return 0
    fi
    sleep 2
  done
  echo "  $name did not become healthy: $url"
  return 1
}

wait_for "http://127.0.0.1:${PYTHON_DIRECT_PORT:-8001}/health" "Python Direct"
wait_for "http://127.0.0.1:${PYTHON_DOWNSTREAM_PORT:-8002}/health" "Python Downstream"
wait_for "http://127.0.0.1:${SPRING_PORT:-8080}/health" "Spring Boot"
wait_for "http://127.0.0.1:${NEXT_PORT:-3000}/api/health" "Next.js"

echo
echo "All services started."
echo "  Dashboard:            http://127.0.0.1:${NEXT_PORT:-3000}"
echo "  Python Direct:        http://127.0.0.1:${PYTHON_DIRECT_PORT:-8001}/health"
echo "  Spring Boot:          http://127.0.0.1:${SPRING_PORT:-8080}/health"
echo "  Python Downstream:    http://127.0.0.1:${PYTHON_DOWNSTREAM_PORT:-8002}/health"
echo "Logs: $ROOT/logs"
