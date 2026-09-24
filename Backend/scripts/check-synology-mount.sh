#!/usr/bin/env bash
# Proactive Synology mount check for JPS API host (production ECS-DB).
# Exit 0 = healthy (CIFS + plausible upload tree). Exit 1 = mount broken or local-disk fallback.
#
# Install (example):
#   chmod +x /opt/jetty-planning-system/Backend/scripts/check-synology-mount.sh
#   crontab -e
#   */15 * * * * /opt/jetty-planning-system/Backend/scripts/check-synology-mount.sh >> /var/log/jps-synology-mount.log 2>&1
#
# Env overrides:
#   JPS_MOUNT=/mnt/synology/JETTYPLANNING
#   JPS_NAS_PARENT=/mnt/synology-apps/JETTYPLANNING   # bind/consistency check (optional)
#   JPS_MIN_OPS_DIRS=30                                # alert if fewer operation/* folders
#   JPS_PROBE_TIMEOUT=8
set -euo pipefail

log() { echo "[$(date -Iseconds)] $*"; }

write_heartbeat() {
  local ok_flag="$1"
  local message="$2"
  local ops_count="${3:-}"
  local target="$JPS_MOUNT/.jps-mount-health.json"
  if [[ -d "$JPS_MOUNT" ]]; then
    printf '{"ok":%s,"checkedAt":"%s","message":"%s","operationsCount":%s}\n' \
      "$ok_flag" "$(date -Iseconds)" "${message//\"/\\\"}" "${ops_count:-null}" > "$target" 2>/dev/null || true
  fi
}

fail() {
  local msg="$*"
  write_heartbeat false "$msg" ""
  log "FAIL: $msg"
  exit 1
}

ok() {
  local msg="$*"
  write_heartbeat true "$msg" "${OPS_COUNT:-null}"
  log "OK: $msg"
  exit 0
}

JPS_MOUNT="${JPS_MOUNT:-/mnt/synology/JETTYPLANNING}"
JPS_NAS_PARENT="${JPS_NAS_PARENT:-/mnt/synology-apps/JETTYPLANNING}"
JPS_MIN_OPS_DIRS="${JPS_MIN_OPS_DIRS:-30}"
JPS_PROBE_TIMEOUT="${JPS_PROBE_TIMEOUT:-8}"

OPS_DIR="$JPS_MOUNT/operations"

# 1) Mount must be CIFS (not plain local directory).
if ! findmnt -T "$JPS_MOUNT" >/dev/null 2>&1; then
  fail "$JPS_MOUNT is not a mount (likely local disk fallback)"
fi

FSTYPE=$(findmnt -T "$JPS_MOUNT" -no FSTYPE 2>/dev/null || true)
if [[ "$FSTYPE" != "cifs" ]]; then
  fail "$JPS_MOUNT FSTYPE=$FSTYPE (expected cifs)"
fi

# 2) Upload tree should not be owned root:root (local rescue pattern).
if [[ -d "$OPS_DIR" ]]; then
  OWNER=$(stat -c '%u:%g' "$OPS_DIR" 2>/dev/null || echo "?")
  if [[ "$OWNER" == "0:0" ]]; then
    fail "$OPS_DIR owned by root:root (local disk, not NAS uid 1001)"
  fi
else
  fail "$OPS_DIR missing"
fi

# 3) Shallow operation folder count (avoid recursive find on CIFS).
OPS_COUNT=$(timeout "$JPS_PROBE_TIMEOUT" ls -1 "$OPS_DIR" 2>/dev/null | wc -l | tr -d ' ')
if [[ -z "$OPS_COUNT" || "$OPS_COUNT" -lt "$JPS_MIN_OPS_DIRS" ]]; then
  fail "operations folder count=$OPS_COUNT (expected >= $JPS_MIN_OPS_DIRS)"
fi

# 4) Bind/consistency: JPS path should see same tree as parent NAS folder (when both exist).
if [[ -d "$JPS_NAS_PARENT/operations" ]]; then
  PARENT_COUNT=$(timeout "$JPS_PROBE_TIMEOUT" ls -1 "$JPS_NAS_PARENT/operations" 2>/dev/null | wc -l | tr -d ' ')
  if [[ -n "$PARENT_COUNT" && "$PARENT_COUNT" -ge "$JPS_MIN_OPS_DIRS" && "$OPS_COUNT" -lt "$((PARENT_COUNT / 2))" ]]; then
    fail "operations count mismatch: $JPS_MOUNT=$OPS_COUNT vs parent=$PARENT_COUNT (split storage?)"
  fi
fi

# 5) Write probe on JPS mount; must appear on parent NAS path when bind is correct.
PROBE="$JPS_MOUNT/.jps-mount-probe-$$"
PARENT_PROBE="$JPS_NAS_PARENT/$(basename "$PROBE")"
cleanup() { rm -f "$PROBE" "$PARENT_PROBE" 2>/dev/null || true; }
trap cleanup EXIT

if ! timeout "$JPS_PROBE_TIMEOUT" touch "$PROBE" 2>/dev/null; then
  fail "cannot write probe file under $JPS_MOUNT (stale mount or permissions)"
fi

if [[ -d "$JPS_NAS_PARENT" ]] && [[ ! -f "$PARENT_PROBE" ]]; then
  fail "probe written to $JPS_MOUNT but not visible on $JPS_NAS_PARENT (wrong bind or local disk)"
fi

ok "cifs mount healthy; operations=$OPS_COUNT"
