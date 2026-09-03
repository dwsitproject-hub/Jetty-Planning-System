#!/usr/bin/env bash
# JPS staging cutover: DB ECS (172.28.92.60) → ApsaraDB RDS
# Run on API server: /opt/jetty-planning-system
# Requires: Backend/.env with DB_HOST, POSTGRES_*, JWT_SECRET; RDS credentials filled below.
#
# Usage:
#   export RDS_HOST='pgm-d9jx9o06qae8gf3h.pgsql.ap-southeast-5.rds.aliyuncs.com'
#   export RDS_PW='...'
#   export SRC_HOST='172.28.92.60'
#   export SRC_PW='...'   # jps_user password on DB ECS
#   ./Backend/scripts/apsaradb-staging-cutover.sh dump-restore
#   ./Backend/scripts/apsaradb-staging-cutover.sh cutover-api
#   ./Backend/scripts/apsaradb-staging-cutover.sh rollback
#
# See Docs/Guide/APSARADB-LOCAL-ACCESS.md and PostgreSQL_to_ApsaraDB_RDS_Dump_Restore_Runbook.docx

set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/jetty-planning-system}"
cd "$APP_ROOT"

RDS_HOST="${RDS_HOST:?Set RDS_HOST}"
RDS_PW="${RDS_PW:?Set RDS_PW}"
RDS_USER="${RDS_USER:-postgres}"
RDS_DB="${RDS_DB:-jps_db}"
SRC_HOST="${SRC_HOST:-172.28.92.60}"
SRC_PORT="${SRC_PORT:-5432}"
SRC_USER="${SRC_USER:-jps_user}"
SRC_DB="${SRC_DB:-jps_db}"
SRC_PW="${SRC_PW:?Set SRC_PW (jps_user on DB ECS)}"
OLD_DB_HOST="${OLD_DB_HOST:-172.28.92.60}"

STAMP="${STAMP:-$(date +%Y%m%d_%H%M%S)}"
BACKUP_DIR="$APP_ROOT/backups/apsaradb_${STAMP}"
mkdir -p "$BACKUP_DIR"

S() {
  docker run --rm -e PGPASSWORD="$SRC_PW" postgres:18 \
    psql -h "$SRC_HOST" -p "$SRC_PORT" -U "$SRC_USER" -d "$SRC_DB" -t -A "$@"
}
R() {
  docker run --rm -e PGPASSWORD="$RDS_PW" postgres:18 \
    psql -h "$RDS_HOST" -U "$RDS_USER" -d "$RDS_DB" -t -A "$@"
}

cmd="${1:-}"

case "$cmd" in
  preflight)
    echo "=== Source (DB ECS) ==="
    S -c "SELECT version(); SELECT pg_size_pretty(pg_database_size(current_database()));"
    S -c "SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM operations; SELECT COUNT(*) FROM schema_migrations;"
    echo "=== RDS target ==="
    docker run --rm -e PGPASSWORD="$RDS_PW" postgres:18 \
      pg_isready -h "$RDS_HOST" -p 5432 -U "$RDS_USER" -d "$RDS_DB"
    R -c "SELECT version(); SHOW TimeZone;"
    ;;

  dump-restore)
    echo "=== Stop API (freeze writes) ==="
    docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml stop jps-api || true

    echo "=== Baseline counts ==="
    S -c "SELECT COUNT(*) FROM users;" | tee "$BACKUP_DIR/source_users.txt"
    S -c "SELECT COUNT(*) FROM operations;" | tee "$BACKUP_DIR/source_operations.txt"

    echo "=== Dump ==="
    docker run --rm -e PGPASSWORD="$SRC_PW" -v "$BACKUP_DIR:/b" postgres:18 \
      pg_dump -h "$SRC_HOST" -p "$SRC_PORT" -U "$SRC_USER" -d "$SRC_DB" \
              -Fc --no-owner --no-privileges -f "/b/cutover.dump"
    TD=$(docker run --rm -v "$BACKUP_DIR:/b" postgres:18 pg_restore -l /b/cutover.dump | grep -c 'TABLE DATA' || true)
    echo "TABLE DATA entries: $TD"

    echo "=== Prepare RDS ==="
    R -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO $RDS_USER; GRANT ALL ON SCHEMA public TO public;"

    echo "=== Restore ==="
    docker run --rm -e PGPASSWORD="$RDS_PW" -v "$BACKUP_DIR:/b" postgres:18 \
      pg_restore -h "$RDS_HOST" -U "$RDS_USER" -d "$RDS_DB" \
                 --no-owner --no-privileges -j 4 /b/cutover.dump \
      > "$BACKUP_DIR/restore.log" 2>&1 || true
    grep -ci 'pg_restore: error' "$BACKUP_DIR/restore.log" || true

    R -c "ANALYZE;"

    echo "=== Verify counts ==="
    R -c "SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM operations; SELECT COUNT(*) FROM schema_migrations;"
    echo "Backup dir: $BACKUP_DIR"
    ;;

  cutover-api)
    cp Backend/.env "$BACKUP_DIR/Backend.env.bak" 2>/dev/null || cp Backend/.env "Backend/.env.bak.apsaradb.$STAMP"
    sed -i \
      -e "s|^DB_HOST=.*|DB_HOST=$RDS_HOST|" \
      -e 's|^DB_PORT=.*|DB_PORT=5432|' \
      -e "s|^POSTGRES_USER=.*|POSTGRES_USER=$RDS_USER|" \
      -e "s|^POSTGRES_DB=.*|POSTGRES_DB=$RDS_DB|" \
      -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$RDS_PW|" \
      Backend/.env
    # # in password breaks compose-built DATABASE_URL — pass URL-encoded override
    RDS_PW_ENC="${RDS_PW//#/%23}"
    DATABASE_URL="postgresql://${RDS_USER}:${RDS_PW_ENC}@${RDS_HOST}:5432/${RDS_DB}"
    docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml stop jps-api || true
    docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml rm -f jps-api || true
    docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml run -d \
      --no-deps --name jps-api --service-ports \
      -e "DATABASE_URL=$DATABASE_URL" \
      jps-api npm run start
    docker inspect jps-api --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '^DATABASE_URL=|^DB_HOST='
    docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml exec -T jps-api npm run migrate
    ;;

  rollback)
    sed -i \
      -e "s|^DB_HOST=.*|DB_HOST=$OLD_DB_HOST|" \
      -e 's|^DB_PORT=.*|DB_PORT=5432|' \
      Backend/.env
    docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml up -d --force-recreate jps-api
    echo "Rolled back to DB ECS $OLD_DB_HOST — re-enable tank gauging cron manually"
    ;;

  *)
    echo "Usage: $0 {preflight|dump-restore|cutover-api|rollback}"
    exit 1
    ;;
esac
