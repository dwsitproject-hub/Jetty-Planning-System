#!/usr/bin/env bash
# Production API deploy (three-server layout) — API server only.
# App (172.28.80.50) and DB (172.28.92.59) unchanged for API-only releases.
#
# Usage (on API server, as root or deploy user):
#   export DEPLOY_BRANCH=pre-production
#   export DEPLOY_COMMIT=974027f   # optional pin; omit to use branch tip
#   export RUN_MIGRATE=1           # optional; run npm run migrate after up
#   bash Backend/scripts/deploy-prod-api-three-server.sh deploy
#
# Rollback (API server; does not reverse migrations):
#   bash Backend/scripts/deploy-prod-api-three-server.sh rollback
#   export ROLLBACK_SHA=<sha>      # optional; overrides saved SHA file
#
# Frontend-only releases: Backend/scripts/deploy-prod-frontend-three-server.sh (App host).
# See Docs/Guide/HOTFIX-DEPLOY-RUNBOOK.md

set -euo pipefail

REPO_DIR="${JPS_REPO_DIR:-/opt/jetty-planning-system}"
ROLLBACK_SHA_FILE="${JPS_API_ROLLBACK_SHA_FILE:-/root/jps-prod-api-rollback-sha.txt}"
ROLLBACK_LOG_FILE="${JPS_API_ROLLBACK_LOG_FILE:-/root/jps-prod-api-rollback-log.txt}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-pre-production}"
DEPLOY_COMMIT="${DEPLOY_COMMIT:-}"
RUN_MIGRATE="${RUN_MIGRATE:-}"
ENV_FILE="${JPS_API_ENV_FILE:-Backend/.env}"
COMPOSE_FILE="${JPS_API_COMPOSE:-docker-compose.backend-api-only.yml}"
API_PORT="${JPS_API_PORT:-3000}"

cd "$REPO_DIR"

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

require_env_file() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Missing $ENV_FILE — create it on the API host before deploy (see PRODUCTION-THREE-SERVER-DEPLOY-AND-FULL-DATA-MIGRATION.md §6)." >&2
    exit 1
  fi
}

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

rebuild_api() {
  require_env_file
  compose build --no-cache jps-api
  compose up -d jps-api
  compose ps
  compose logs --tail=25 jps-api
  curl -sS "http://127.0.0.1:${API_PORT}/health"
  echo
  curl -sS "http://127.0.0.1:${API_PORT}/api/v1/health"
  echo
  if [[ "$RUN_MIGRATE" == "1" ]]; then
    echo "=== Running migrations (RUN_MIGRATE=1) ==="
    compose exec -T jps-api npm run migrate
  else
    echo "Migrations skipped (set RUN_MIGRATE=1 to apply Backend/migrations)."
  fi
}

cmd_deploy() {
  echo "=== 1/3 Save rollback point (API server) ==="
  save_rollback_point
  echo "=== 2/3 Checkout ${DEPLOY_BRANCH}${DEPLOY_COMMIT:+ @ ${DEPLOY_COMMIT}} ==="
  checkout_deploy_ref
  echo "=== 3/3 Rebuild API (jps-api) ==="
  rebuild_api
  echo "Deploy complete. Run API/browser smoke test (see HOTFIX-DEPLOY-RUNBOOK.md §7)."
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
  echo "Rolling back API to $sha (migrations are not reversed)"
  git fetch origin
  git checkout "$sha"
  git log -1 --oneline
  RUN_MIGRATE=""
  rebuild_api
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
