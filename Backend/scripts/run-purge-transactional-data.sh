#!/usr/bin/env bash
# =============================================================================
# Run purge-transactional-data.sql against jps-db (Docker).
#
# NOT a migration. Requires explicit confirmation.
#
# Usage (on BACKEND server, from repo root e.g. /opt/jetty-planning-system):
#   bash Backend/scripts/run-purge-transactional-data.sh
#
# Optional env overrides:
#   COMPOSE_FILE=docker-compose.backend.yml
#   ENV_FILE=Backend/.env
#   POSTGRES_USER=jps_user
#   POSTGRES_DB=jps_db
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SQL_FILE="${SCRIPT_DIR}/purge-transactional-data.sql"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.backend.yml}"
ENV_FILE="${ENV_FILE:-Backend/.env}"

cd "${REPO_ROOT}"

if [[ ! -f "${SQL_FILE}" ]]; then
  echo "ERROR: SQL file not found: ${SQL_FILE}" >&2
  exit 1
fi

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "ERROR: Compose file not found: ${REPO_ROOT}/${COMPOSE_FILE}" >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: Env file not found: ${REPO_ROOT}/${ENV_FILE}" >&2
  exit 1
fi

# Load DB user/db name from env file for psql (password not needed inside jps-db container)
# shellcheck disable=SC1090
set -a
source "${ENV_FILE}"
set +a
PGUSER="${POSTGRES_USER:-jps_user}"
PGDB="${POSTGRES_DB:-jps_db}"

echo ""
echo "=================================================================="
echo "  JPS — PURGE ALL TRANSACTIONAL DATA"
echo "=================================================================="
echo "  Host:     $(hostname 2>/dev/null || echo unknown)"
echo "  Repo:     ${REPO_ROOT}"
echo "  SQL:      ${SQL_FILE}"
echo "  Database: ${PGDB} (user ${PGUSER}) via Docker service jps-db"
echo ""
echo "  This PERMANENTLY deletes shipment plans, SIs, operations,"
echo "  allocation, at-berth, clearance, QC, activity logs, notifications."
echo "  Master data, users, and RBAC are kept."
echo ""
echo "  Type exactly:  PURGE"
echo "=================================================================="
read -r -p "Confirm: " CONFIRM
if [[ "${CONFIRM}" != "PURGE" ]]; then
  echo "Aborted (confirmation did not match PURGE)."
  exit 1
fi

echo ""
echo "Running purge..."
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T jps-db \
  psql -v ON_ERROR_STOP=1 -U "${PGUSER}" -d "${PGDB}" \
  < "${SQL_FILE}"

echo ""
echo "Done. Optional: remove uploaded files under API UPLOAD_DIR if you need a full file reset."
