#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/aggregate-daily-cargo-progress.js "$@"
