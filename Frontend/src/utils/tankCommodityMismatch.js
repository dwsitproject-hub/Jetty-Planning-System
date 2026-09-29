/**
 * Soft warning when shore tank ATG product name disagrees with selected SI commodity.
 */

function normalizeProductToken(s) {
  return String(s || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

/**
 * @param {string|null|undefined} selectedShortName from SI commodity option
 * @param {Array<{ id?: string, code?: string, productName?: string|null }>} tanks
 * @param {Map<string, { productName?: string|null }>|Record<string, { productName?: string }>} [tankMetaById]
 * @returns {string[]} human-readable warnings (empty if none)
 */
export function buildTankCommodityMismatchWarnings(selectedShortName, tankIds, tankMetaById) {
  const productLabel = String(selectedShortName || '').trim()
  if (!productLabel || !Array.isArray(tankIds) || tankIds.length === 0) return []

  const want = normalizeProductToken(productLabel)
  if (!want) return []

  const meta =
    tankMetaById instanceof Map
      ? tankMetaById
      : new Map(Object.entries(tankMetaById || {}).map(([k, v]) => [String(k), v]))

  const warnings = []
  for (const tid of tankIds) {
    const id = String(tid)
    const tk = meta.get(id)
    const pn = tk?.productName
    if (!pn || !String(pn).trim()) continue
    const have = normalizeProductToken(pn)
    if (!have) continue
    if (have.includes(want) || want.includes(have)) continue
    const code = tk?.code || id
    warnings.push(
      `Tank ${code} is ${String(pn).trim()} on Tank Farm; you selected ${productLabel}. Continue only if this is correct.`
    )
  }
  return warnings
}
