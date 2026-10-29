/**
 * Partner (integration API) source of a shipping instruction.
 * The partner name is the label of the API key that submitted the SI; internal SIs have none.
 */

/**
 * LATERAL join exposing `si_partner.partner_name` for the `si` alias.
 * Limited to one row (newest submission) so an SI is never duplicated by the join.
 */
export const SI_PARTNER_SOURCE_JOIN = `
  LEFT JOIN LATERAL (
    SELECT k.partner_name
    FROM integration_submissions isub
    JOIN integration_api_keys k ON k.id = isub.api_key_id
    WHERE isub.shipping_instruction_id = si.id
    ORDER BY isub.id DESC
    LIMIT 1
  ) si_partner ON true`;

/**
 * LATERAL join exposing `sp_partner.partner_name` for the `sp` shipment plan alias.
 * Limited to one row (newest submission) so a plan is never duplicated by the join.
 */
export const PLAN_PARTNER_SOURCE_JOIN = `
  LEFT JOIN LATERAL (
    SELECT k.partner_name
    FROM integration_submissions isub
    JOIN integration_api_keys k ON k.id = isub.api_key_id
    WHERE isub.shipment_plan_id = sp.id
    ORDER BY isub.id DESC
    LIMIT 1
  ) sp_partner ON true`;

/**
 * @param {Record<string, unknown>} row Row with partner_name and partner_*_document_url columns.
 * @returns {{
 *   partnerName: string | null,
 *   partnerSiDocumentUrl: string | null,
 *   partnerContractDocumentUrl: string | null,
 *   partnerBlDocumentUrl: string | null,
 * }}
 */
export function mapSiPartnerFields(row) {
  return {
    partnerName: row.partner_name ?? null,
    partnerSiDocumentUrl: row.partner_si_document_url ?? null,
    partnerContractDocumentUrl: row.partner_contract_document_url ?? null,
    partnerBlDocumentUrl: row.partner_bl_document_url ?? null,
  };
}
