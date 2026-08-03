#!/usr/bin/env bash
# Cron-friendly wrapper for staged ATG sample archive/delete.
# Usage:
#   ./scripts/purge-tank-gauging-samples.sh
#   ./scripts/purge-tank-gauging-samples.sh --dry-run
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/purge-tank-gauging-samples.js "$@"
