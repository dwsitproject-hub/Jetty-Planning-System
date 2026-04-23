/**
 * Jetty Operation Id: LD|UN-YY-MM-#### (assigned in DB via assign_jetty_operation_code).
 * Timezone must match migration 056 backfill literal unless that migration is edited pre-first-apply.
 */
const DEFAULT_TZ = 'Asia/Jakarta';

export function getJettyOperationCodeTimezone() {
  const t = process.env.JETTY_OPERATION_CODE_TIMEZONE?.trim();
  return t || DEFAULT_TZ;
}

/**
 * @param {import('pg').PoolClient} client
 * @param {number|string} operationId
 */
export async function assignJettyOperationCode(client, operationId) {
  const id = typeof operationId === 'string' ? parseInt(operationId, 10) : operationId;
  if (!Number.isFinite(id)) {
    throw new Error('assignJettyOperationCode: invalid operation id');
  }
  const tz = getJettyOperationCodeTimezone();
  await client.query('SELECT public.assign_jetty_operation_code($1::bigint, $2::text)', [id, tz]);
}
