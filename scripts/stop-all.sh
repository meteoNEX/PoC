#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/.pids"

stop_pidfile() {
  local file="$1"
  if [[ -f "$file" ]]; then
    local pid
    pid="$(cat "$file")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$file"
  fi
}

stop_pidfile "$ROOT/.pids/next.pid"
stop_pidfile "$ROOT/.pids/spring.pid"
stop_pidfile "$ROOT/.pids/python-direct.pid"
stop_pidfile "$ROOT/.pids/python-downstream.pid"

# Spring Boot may leave a child JVM around.
pkill -f "backend-spring" 2>/dev/null || true
pkill -f "sentry-poc" 2>/dev/null || true

echo "Stopped PoC processes (if they were running)."
