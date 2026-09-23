#!/usr/bin/env bash
# Production daily dump — ApsaraDB RDS (run on API 172.28.80.51).
# Install as /opt/jetty-planning-system/backups/jps-backup-db-daily.sh (same path as crontab).
# Does not overwrite or purge existing jps_db_YYYYMMDD.dump files on Synology.
set -euo pipefail

log() { echo "[$(date -Iseconds)] $*"; }
die() { log "ERROR: $*"; exit 1; }

ENV_FILE=/opt/jetty-planning-system/Backend/.env
LOCAL_DIR=/opt/jetty-planning-system/backups/daily
NAS_DIR=/mnt/synology/JETTYPLANNING/db-backups
DB_HOST="${JPS_BACKUP_RDS_HOST:-pgm-d9jn3khh0b3907w4.pgsql.ap-southeast-5.rds.aliyuncs.com}"
DB_PORT=5432
LOCAL_DAYS=3
NAS_DAYS=14
PG_IMAGE="${JPS_BACKUP_PG_IMAGE:-postgres:18}"
DUMP_PREFIX=jps_db_rds

env_val() {
  grep "^$1=" "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'"
}

POSTGRES_USER=$(env_val POSTGRES_USER)
POSTGRES_DB=$(env_val POSTGRES_DB)
POSTGRES_PASSWORD=$(env_val POSTGRES_PASSWORD)
[[ -n "$POSTGRES_PASSWORD" ]] || die "POSTGRES_PASSWORD empty"
[[ -n "$POSTGRES_USER" ]] || POSTGRES_USER=postgres
[[ -n "$POSTGRES_DB" ]] || POSTGRES_DB=jps_db

STAMP=$(date +%Y%m%d)
DUMP_NAME=${DUMP_PREFIX}_${STAMP}.dump
mkdir -p "$LOCAL_DIR" "$NAS_DIR"

log "dump start host=${DB_HOST} db=${POSTGRES_DB} user=${POSTGRES_USER} stamp=${STAMP}"
docker run --rm --network host \
  -e PGPASSWORD="$POSTGRES_PASSWORD" \
  -v "$LOCAL_DIR:/b" \
  "$PG_IMAGE" \
  pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -Fc --no-owner --no-acl -f "/b/${DUMP_NAME}"

TOC=$(docker run --rm -v "$LOCAL_DIR:/b" "$PG_IMAGE" \
  pg_restore -l "/b/${DUMP_NAME}" | grep -c 'TABLE DATA' || true)
[[ "$TOC" -ge 1 ]] || die "dump TOC has no TABLE DATA"

BYTES=$(wc -c < "${LOCAL_DIR}/${DUMP_NAME}" | tr -d ' ')
[[ "$BYTES" -gt 1024 ]] || die "dump too small (${BYTES} bytes)"
log "dump ok bytes=${BYTES} table_data=${TOC}"

cp -a "${LOCAL_DIR}/${DUMP_NAME}" "${NAS_DIR}/"
NAS_BYTES=$(wc -c < "${NAS_DIR}/${DUMP_NAME}" | tr -d ' ')
[[ "$NAS_BYTES" -eq "$BYTES" ]] || die "NAS copy size mismatch (local=${BYTES} nas=${NAS_BYTES})"
rm -f "${LOCAL_DIR}/${DUMP_NAME}"
log "copied to ${NAS_DIR}/${DUMP_NAME} and removed local copy"

cutoff_local=$(date -d "${LOCAL_DAYS} days ago" +%Y%m%d)
cutoff_nas=$(date -d "${NAS_DAYS} days ago" +%Y%m%d)
shopt -s nullglob
for f in "$LOCAL_DIR"/${DUMP_PREFIX}_*.dump; do
  s=$(basename "$f"); s=${s#${DUMP_PREFIX}_}; s=${s%.dump}
  [[ "$s" =~ ^[0-9]{8}$ && "$s" < "$cutoff_local" ]] && rm -f "$f" && log "purge local $(basename "$f")"
done
for f in "$NAS_DIR"/${DUMP_PREFIX}_*.dump; do
  s=$(basename "$f"); s=${s#${DUMP_PREFIX}_}; s=${s%.dump}
  [[ "$s" =~ ^[0-9]{8}$ && "$s" < "$cutoff_nas" ]] && rm -f "$f" && log "purge nas $(basename "$f")"
done
log "backup complete"
