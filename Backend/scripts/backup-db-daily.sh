#!/usr/bin/env bash
# Daily PostgreSQL dump for the production DB host (jps-db).
# Copies the dump off-host (Synology via the API server) and purges old files.
#
# Usage (on 172.28.92.59):
#   ./scripts/backup-db-daily.sh
#
# Optional env (defaults are production):
#   JPS_BACKUP_DIR          local dump directory
#   JPS_BACKUP_REMOTE       local path OR user@host:path (rsync)
#   JPS_BACKUP_LOCAL_DAYS   keep this many days on the DB host (default 3)
#   JPS_BACKUP_NAS_DAYS     keep this many days on NAS (default 14)
#   JPS_BACKUP_CONTAINER    docker container name (default jps-db)
#   POSTGRES_USER / POSTGRES_DB
set -euo pipefail

log() { echo "[$(date -Iseconds)] $*"; }
die() { log "ERROR: $*"; exit 1; }

CONTAINER="${JPS_BACKUP_CONTAINER:-jps-db}"
PGUSER="${POSTGRES_USER:-jps_user}"
PGDB="${POSTGRES_DB:-jps_db}"
BACKUP_DIR="${JPS_BACKUP_DIR:-/opt/jetty-planning-system/backups/daily}"
REMOTE="${JPS_BACKUP_REMOTE:-root@172.28.80.51:/mnt/synology/JETTYPLANNING/db-backups}"
LOCAL_DAYS="${JPS_BACKUP_LOCAL_DAYS:-3}"
NAS_DAYS="${JPS_BACKUP_NAS_DAYS:-14}"
SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=15"

STAMP="$(date +%Y%m%d)"
DUMP_NAME="jps_db_${STAMP}.dump"
CONTAINER_DUMP="/tmp/${DUMP_NAME}"
LOCAL_DUMP="${BACKUP_DIR}/${DUMP_NAME}"

is_ssh_remote() {
  [[ "$1" == *:* && "$1" != /* ]]
}

cutoff_yyyymmdd() {
  date -d "$1 days ago" +%Y%m%d
}

# Delete jps_db_YYYYMMDD.dump files whose stamp is older than cutoff (YYYYMMDD).
purge_local_dir() {
  local dir="$1" cutoff="$2" f base stamp
  [[ -d "$dir" ]] || return 0
  shopt -s nullglob
  for f in "$dir"/jps_db_*.dump; do
    base="$(basename "$f")"
    stamp="${base#jps_db_}"
    stamp="${stamp%.dump}"
    if [[ "$stamp" =~ ^[0-9]{8}$ && "$stamp" < "$cutoff" ]]; then
      log "purge local ${base} (older than ${cutoff})"
      rm -f "$f"
    fi
  done
  shopt -u nullglob
}

purge_ssh_remote() {
  local spec="$1" cutoff="$2"
  local host="${spec%%:*}"
  local path="${spec#*:}"
  ssh $SSH_OPTS "$host" "bash -s" <<EOF
set -euo pipefail
cutoff='$cutoff'
dir='$path'
shopt -s nullglob
for f in "\$dir"/jps_db_*.dump; do
  base=\$(basename "\$f")
  stamp=\${base#jps_db_}
  stamp=\${stamp%.dump}
  if [[ "\$stamp" =~ ^[0-9]{8}\$ && "\$stamp" < "\$cutoff" ]]; then
    echo "[purge remote] \$base (older than \$cutoff)"
    rm -f "\$f"
  fi
done
EOF
}

# Avoid overlapping cron runs.
LOCK_FILE="${JPS_BACKUP_LOCK:-/tmp/jps-db-backup.lock}"
exec 9>"$LOCK_FILE"
flock -n 9 || die "another backup-db-daily.sh is already running"

[[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || true)" == "true" ]] \
  || die "container ${CONTAINER} is not running"

mkdir -p "$BACKUP_DIR"

log "dump start container=${CONTAINER} db=${PGDB} stamp=${STAMP}"
docker exec "$CONTAINER" rm -f "$CONTAINER_DUMP"
docker exec "$CONTAINER" \
  pg_dump -U "$PGUSER" -d "$PGDB" -Fc --no-owner --no-acl -f "$CONTAINER_DUMP"

TOC_COUNT="$(docker exec "$CONTAINER" pg_restore -l "$CONTAINER_DUMP" | grep -c 'TABLE DATA' || true)"
[[ "${TOC_COUNT}" -ge 1 ]] || die "dump TOC has no TABLE DATA entries (corrupt or empty)"

docker cp "${CONTAINER}:${CONTAINER_DUMP}" "$LOCAL_DUMP"
docker exec "$CONTAINER" rm -f "$CONTAINER_DUMP"
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

# Purge only after a verified dump (and a successful copy when remote is set).
purge_local_dir "$BACKUP_DIR" "$(cutoff_yyyymmdd "$LOCAL_DAYS")"
if [[ -n "$REMOTE" ]]; then
  if is_ssh_remote "$REMOTE"; then
    purge_ssh_remote "$REMOTE" "$(cutoff_yyyymmdd "$NAS_DAYS")"
  else
    purge_local_dir "$REMOTE" "$(cutoff_yyyymmdd "$NAS_DAYS")"
  fi
fi

log "backup complete"
