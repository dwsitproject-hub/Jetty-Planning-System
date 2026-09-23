#!/usr/bin/env bash
# Daily PostgreSQL dump. Production (after ApsaraDB): dump RDS from the API host.
# Legacy: dump jps-db on DB ECS (do not use for live prod; would copy a stale DB).
#
# Production (172.28.80.51):
#   JPS_BACKUP_MODE=rds ./Backend/scripts/backup-db-daily.sh
#
# Existing Synology files named jps_db_YYYYMMDD.dump are never deleted or overwritten.
# RDS dumps use jps_db_rds_YYYYMMDD.dump in the same folder.
#
# Env:
#   JPS_BACKUP_MODE         rds (default if DB_HOST looks like RDS) | container
#   JPS_BACKUP_RDS_HOST     RDS hostname (default: DB_HOST)
#   JPS_BACKUP_RDS_PORT     default 5432
#   JPS_BACKUP_PG_IMAGE     default postgres:18
#   JPS_BACKUP_DIR          local dump directory
#   JPS_BACKUP_REMOTE       local path OR user@host:path (rsync)
#   JPS_BACKUP_LOCAL_DAYS   keep this many days locally (default 3)
#   JPS_BACKUP_NAS_DAYS     keep this many days on NAS for RDS dumps only (default 14)
#   JPS_BACKUP_CONTAINER    docker container (container mode only)
#   POSTGRES_USER / POSTGRES_DB / POSTGRES_PASSWORD or PGPASSWORD
set -euo pipefail

log() { echo "[$(date -Iseconds)] $*"; }
die() { log "ERROR: $*"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Optional: load Backend/.env without printing secrets (cron has a thin environment).
if [[ -f "$APP_ROOT/Backend/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$APP_ROOT/Backend/.env"
  set +a
fi

DB_HOST_VAL="${DB_HOST:-}"
if [[ -z "${JPS_BACKUP_MODE:-}" ]]; then
  if [[ "${DB_HOST_VAL}" == *rds.aliyuncs.com* ]] || [[ -n "${JPS_BACKUP_RDS_HOST:-}" ]]; then
    JPS_BACKUP_MODE=rds
  else
    JPS_BACKUP_MODE=container
  fi
fi

RDS_HOST="${JPS_BACKUP_RDS_HOST:-$DB_HOST_VAL}"
RDS_PORT="${JPS_BACKUP_RDS_PORT:-${DB_PORT:-5432}}"
PG_IMAGE="${JPS_BACKUP_PG_IMAGE:-postgres:18}"
CONTAINER="${JPS_BACKUP_CONTAINER:-jps-db}"
PGDB="${POSTGRES_DB:-jps_db}"
BACKUP_DIR="${JPS_BACKUP_DIR:-/opt/jetty-planning-system/backups/daily}"
LOCAL_DAYS="${JPS_BACKUP_LOCAL_DAYS:-3}"
NAS_DAYS="${JPS_BACKUP_NAS_DAYS:-14}"
SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=15"

if [[ "$JPS_BACKUP_MODE" == "rds" ]]; then
  PGUSER="${POSTGRES_USER:-postgres}"
  DUMP_PREFIX="jps_db_rds"
  # API host already has NAS mounted — copy locally; do not SSH overwrite old dumps.
  REMOTE="${JPS_BACKUP_REMOTE:-/mnt/synology/JETTYPLANNING/db-backups}"
else
  PGUSER="${POSTGRES_USER:-jps_user}"
  DUMP_PREFIX="jps_db"
  REMOTE="${JPS_BACKUP_REMOTE:-root@172.28.80.51:/mnt/synology/JETTYPLANNING/db-backups}"
fi

STAMP="$(date +%Y%m%d)"
DUMP_NAME="${DUMP_PREFIX}_${STAMP}.dump"
LOCAL_DUMP="${BACKUP_DIR}/${DUMP_NAME}"
PGPASSWORD="${PGPASSWORD:-${POSTGRES_PASSWORD:-}}"

is_ssh_remote() {
  [[ "$1" == *:* && "$1" != /* ]]
}

cutoff_yyyymmdd() {
  date -d "$1 days ago" +%Y%m%d
}

# Purge only DUMP_PREFIX_YYYYMMDD.dump (never jps_db_YYYYMMDD.dump when prefix is jps_db_rds).
purge_local_dir() {
  local dir="$1" cutoff="$2" prefix="$3" f base stamp
  [[ -d "$dir" ]] || return 0
  shopt -s nullglob
  for f in "$dir"/"${prefix}"_*.dump; do
    base="$(basename "$f")"
    stamp="${base#${prefix}_}"
    stamp="${stamp%.dump}"
    if [[ "$stamp" =~ ^[0-9]{8}$ && "$stamp" < "$cutoff" ]]; then
      log "purge local ${base} (older than ${cutoff})"
      rm -f "$f"
    fi
  done
  shopt -u nullglob
}

purge_ssh_remote() {
  local spec="$1" cutoff="$2" prefix="$3"
  local host="${spec%%:*}"
  local path="${spec#*:}"
  ssh $SSH_OPTS "$host" "bash -s" <<EOF
set -euo pipefail
cutoff='$cutoff'
dir='$path'
prefix='$prefix'
shopt -s nullglob
for f in "\$dir"/"\${prefix}"_*.dump; do
  base=\$(basename "\$f")
  stamp=\${base#\${prefix}_}
  stamp=\${stamp%.dump}
  if [[ "\$stamp" =~ ^[0-9]{8}\$ && "\$stamp" < "\$cutoff" ]]; then
    echo "[purge remote] \$base (older than \$cutoff)"
    rm -f "\$f"
  fi
done
EOF
}

LOCK_FILE="${JPS_BACKUP_LOCK:-/tmp/jps-db-backup.lock}"
exec 9>"$LOCK_FILE"
flock -n 9 || die "another backup-db-daily.sh is already running"

mkdir -p "$BACKUP_DIR"

if [[ "$JPS_BACKUP_MODE" == "rds" ]]; then
  [[ -n "$RDS_HOST" ]] || die "JPS_BACKUP_MODE=rds requires JPS_BACKUP_RDS_HOST or DB_HOST"
  [[ -n "$PGPASSWORD" ]] || die "set PGPASSWORD or POSTGRES_PASSWORD (RDS user password)"
  export PGPASSWORD
  log "dump start mode=rds host=${RDS_HOST} db=${PGDB} user=${PGUSER} stamp=${STAMP}"
  docker run --rm --network host \
    -e PGPASSWORD \
    -v "$BACKUP_DIR:/b" \
    "$PG_IMAGE" \
    pg_dump -h "$RDS_HOST" -p "$RDS_PORT" -U "$PGUSER" -d "$PGDB" \
      -Fc --no-owner --no-acl -f "/b/${DUMP_NAME}"
  TOC_COUNT="$(docker run --rm -v "$BACKUP_DIR:/b" "$PG_IMAGE" \
    pg_restore -l "/b/${DUMP_NAME}" | grep -c 'TABLE DATA' || true)"
else
  [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || true)" == "true" ]] \
    || die "container ${CONTAINER} is not running"
  log "dump start mode=container container=${CONTAINER} db=${PGDB} stamp=${STAMP}"
  docker exec "$CONTAINER" rm -f "/tmp/${DUMP_NAME}"
  docker exec "$CONTAINER" \
    pg_dump -U "$PGUSER" -d "$PGDB" -Fc --no-owner --no-acl -f "/tmp/${DUMP_NAME}"
  TOC_COUNT="$(docker exec "$CONTAINER" pg_restore -l "/tmp/${DUMP_NAME}" | grep -c 'TABLE DATA' || true)"
  docker cp "${CONTAINER}:/tmp/${DUMP_NAME}" "$LOCAL_DUMP"
  docker exec "$CONTAINER" rm -f "/tmp/${DUMP_NAME}"
fi

[[ "${TOC_COUNT}" -ge 1 ]] || die "dump TOC has no TABLE DATA entries (corrupt or empty)"
chmod 600 "$LOCAL_DUMP"
BYTES="$(wc -c < "$LOCAL_DUMP" | tr -d ' ')"
[[ "${BYTES}" -gt 1024 ]] || die "dump is too small (${BYTES} bytes)"
log "dump ok file=${LOCAL_DUMP} bytes=${BYTES} table_data=${TOC_COUNT}"

if [[ -n "$REMOTE" ]]; then
  if is_ssh_remote "$REMOTE"; then
    host="${REMOTE%%:*}"
    path="${REMOTE#*:}"
    log "copy to ${REMOTE}"
    ssh $SSH_OPTS "$host" "mkdir -p '$path'"
    rsync -a -e "ssh $SSH_OPTS" "$LOCAL_DUMP" "${REMOTE%/}/"
  else
    log "copy to local path ${REMOTE}"
    mkdir -p "$REMOTE"
    cp -a "$LOCAL_DUMP" "${REMOTE%/}/"
    chmod 600 "${REMOTE%/}/${DUMP_NAME}"
  fi
  log "off-host copy ok"
else
  log "JPS_BACKUP_REMOTE empty — skip off-host copy"
fi

purge_local_dir "$BACKUP_DIR" "$(cutoff_yyyymmdd "$LOCAL_DAYS")" "$DUMP_PREFIX"
if [[ -n "$REMOTE" ]]; then
  if is_ssh_remote "$REMOTE"; then
    purge_ssh_remote "$REMOTE" "$(cutoff_yyyymmdd "$NAS_DAYS")" "$DUMP_PREFIX"
  else
    purge_local_dir "$REMOTE" "$(cutoff_yyyymmdd "$NAS_DAYS")" "$DUMP_PREFIX"
  fi
fi

log "backup complete"
