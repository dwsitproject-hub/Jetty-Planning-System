#!/usr/bin/env bash
# Production frontend deploy (three-server layout) — App server only.
# API (172.28.80.51) and DB (172.28.92.59) unchanged for frontend-only releases.
#
# Usage (on App server, as root or deploy user):
#   export DEPLOY_BRANCH=pre-production
#   export DEPLOY_COMMIT=974027f   # optional pin; omit to use branch tip
#   bash Backend/scripts/deploy-prod-frontend-three-server.sh deploy
#
# Rollback (App server):
#   bash Backend/scripts/deploy-prod-frontend-three-server.sh rollback
#   export ROLLBACK_SHA=<sha>      # optional; overrides saved SHA file
#
# API-only releases: Backend/scripts/deploy-prod-api-three-server.sh (API host).
# See Docs/Guide/HOTFIX-DEPLOY-RUNBOOK.md

set -euo pipefail

REPO_DIR="${JPS_REPO_DIR:-/opt/jetty-planning-system}"
ROLLBACK_SHA_FILE="${JPS_APP_ROLLBACK_SHA_FILE:-/root/jps-prod-app-rollback-sha.txt}"
ROLLBACK_LOG_FILE="${JPS_APP_ROLLBACK_LOG_FILE:-/root/jps-prod-app-rollback-log.txt}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-pre-production}"
DEPLOY_COMMIT="${DEPLOY_COMMIT:-}"
COMPOSE_FILE="${JPS_APP_COMPOSE:-docker-compose.app.yml}"
FE_PORT="${JPS_FE_PORT:-3080}"

cd "$REPO_DIR"

save_rollback_point() {
  git fetch origin
  git rev-parse HEAD | tee "$ROLLBACK_SHA_FILE"
  git log -1 --oneline | tee "$ROLLBACK_LOG_FILE"
  echo "Rollback point saved:"
  cat "$ROLLBACK_SHA_FILE"
  cat "$ROLLBACK_LOG_FILE"
}

checkout_deploy_ref() {
  git fetch origin
  git checkout "$DEPLOY_BRANCH"
  git pull origin "$DEPLOY_BRANCH"
  if [[ -n "$DEPLOY_COMMIT" ]]; then
    git checkout "$DEPLOY_COMMIT"
  fi
  git log -1 --oneline
}

rebuild_app() {
  docker compose -f "$COMPOSE_FILE" build --no-cache jps-fe
  docker compose -f "$COMPOSE_FILE" up -d
  docker compose -f "$COMPOSE_FILE" ps
  curl -sS -o /dev/null -w "SPA HTTP %{http_code}\n" "http://127.0.0.1:${FE_PORT}/"
  curl -sS "http://127.0.0.1:${FE_PORT}/api/v1/health"
  echo
}

cmd_deploy() {
  echo "=== 1/3 Save rollback point (App server) ==="
  save_rollback_point
  echo "=== 2/3 Checkout ${DEPLOY_BRANCH}${DEPLOY_COMMIT:+ @ ${DEPLOY_COMMIT}} ==="
  checkout_deploy_ref
  echo "=== 3/3 Rebuild frontend (jps-fe) ==="
  rebuild_app
  echo "Deploy complete. Run browser smoke test (Allocation → Berthing Plan Gantt)."
}

cmd_rollback() {
  local sha="${ROLLBACK_SHA:-}"
  if [[ -z "$sha" ]]; then
    if [[ ! -f "$ROLLBACK_SHA_FILE" ]]; then
      echo "Missing $ROLLBACK_SHA_FILE — set SHA manually: export ROLLBACK_SHA=<sha>" >&2
      exit 1
    fi
    sha="$(cat "$ROLLBACK_SHA_FILE")"
  fi
  echo "Rolling back App to $sha"
  git fetch origin
  git checkout "$sha"
  git log -1 --oneline
  rebuild_app
  echo "Rollback complete."
}

case "${1:-}" in
  deploy) cmd_deploy ;;
  rollback) cmd_rollback ;;
  *)
    echo "Usage: $0 deploy|rollback" >&2
    exit 1
    ;;
esac
