/** SQL fragment: port row is selectable in app (not soft-deleted, hub-active). */
export const PORT_USER_VISIBLE_SQL = 'deleted_at IS NULL AND is_active IS TRUE';

/** For JOIN aliases e.g. ports p → p.deleted_at IS NULL AND p.is_active IS TRUE */
export function portJoinVisible(alias = 'p') {
  return `${alias}.deleted_at IS NULL AND ${alias}.is_active IS TRUE`;
}
