#!/usr/bin/env bash
# Cron-friendly wrapper for Tankvision ATG poll (run once per invocation).
# Usage (from Backend or via absolute path):
#   ./scripts/run-tank-gauging-poll.sh
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/run-tank-gauging-poll.js "$@"
