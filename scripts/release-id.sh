#!/usr/bin/env bash
# Print sentry-poc@<full git SHA>. Empty if git is unavailable.
# Does not read SENTRY_RELEASE — callers decide whether to override.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if git -C "$ROOT" rev-parse HEAD >/dev/null 2>&1; then
  echo "sentry-poc@$(git -C "$ROOT" rev-parse HEAD)"
else
  echo ""
fi
