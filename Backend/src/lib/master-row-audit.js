/**
 * Shared created/updated user stamps for editable master tables.
 * Display name prefers users.display_name, then username (same as Allocation).
 */

export function actorUserIdFromReq(req) {
  const n = Number(req?.userId);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function masterAuditSelectSql(tableAlias = 't') {
  return `${tableAlias}.created_at,
    ${tableAlias}.updated_at,
    NULLIF(TRIM(COALESCE(cu.display_name, cu.username, '')), '') AS created_by_display_name,
    NULLIF(TRIM(COALESCE(uu.display_name, uu.username, '')), '') AS updated_by_display_name`;
}

export function masterAuditJoinSql(tableAlias = 't') {
  return `LEFT JOIN users cu ON cu.id = ${tableAlias}.created_by AND cu.deleted_at IS NULL
    LEFT JOIN users uu ON uu.id = ${tableAlias}.updated_by AND uu.deleted_at IS NULL`;
}

export function pickMasterAudit(row) {
  return {
    createdAt: row?.created_at ?? null,
    updatedAt: row?.updated_at ?? null,
    createdByDisplayName: row?.created_by_display_name ?? null,
    updatedByDisplayName: row?.updated_by_display_name ?? null,
  };
}
