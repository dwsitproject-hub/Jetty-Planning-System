#!/usr/bin/env bash
# View Backend/.env on the backend ECS over SSH (read-only).
#
# Usage (Git Bash, WSL, Linux, macOS):
#   export BACKEND_SSH='ubuntu@203.0.113.20'
#   export REMOTE_ROOT='/opt/jetty-planning-system'   # optional
#   bash scripts/view-backend-env-remote.sh
#
# WARNING: .env contains secrets — use only on a trusted machine.

set -euo pipefail

BACKEND_SSH="${BACKEND_SSH:?Set BACKEND_SSH, e.g. export BACKEND_SSH='ubuntu@203.0.113.20'}"
REMOTE_ROOT="${REMOTE_ROOT:-/opt/jetty-planning-system}"
REMOTE_ENV="${REMOTE_ROOT}/Backend/.env"

ssh -t -o StrictHostKeyChecking=accept-new "${BACKEND_SSH}" "less '${REMOTE_ENV}'"
