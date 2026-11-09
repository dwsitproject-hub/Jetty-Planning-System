/**
 * Native `title` for a visible short commodity label.
 * Returns undefined when there is nothing extra to show.
 */

export function commodityLongTitle(shortLabel, longLabel) {
  const short = String(shortLabel ?? '').trim()
  const long = String(longLabel ?? '').trim()
  if (!short || !long || short === long) return undefined
  return long
}

export function commodityObjectTitle(c) {
  if (!c) return undefined
  const short = c.shortName || c.name
  return commodityLongTitle(short, c.name)
}

export function commodityRowTitle(row) {
  if (!row) return undefined
  return commodityLongTitle(row.commodityShortDisplay, row.commodityDisplay)
}

/** Visible picker label: material code, then short name. Long name when the short name is empty. */
export function commodityDropdownLabel(c) {
  if (!c) return ''
  const short = String(c.shortName ?? c.short_name ?? c.commodityShortName ?? '').trim()
  const long = String(c.name ?? c.commodityName ?? '').trim()
  const name = short || long
  const code = String(c.materialCode ?? c.material_code ?? '').trim()
  if (code && name) return `${code} - ${name}`
  return name || code
}

/** Search text: material code, short name, and long name. */
export function commoditySearchKeywords(c) {
  if (!c) return ''
  return [c.materialCode, c.material_code, c.shortName, c.short_name, c.commodityShortName, c.name, c.commodityName]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .join(' ')
}

/**
 * Active commodities for a dropdown, plus the saved line when it is no longer active.
 * @param {Array<object> | null | undefined} commodities
 * @param {{ commodityId?: string | number, commodityName?: string, commodityShortName?: string, shortName?: string, materialCode?: string } | null | undefined} selected
 */
export function commodityDropdownOptions(commodities, selected) {
  const list = (Array.isArray(commodities) ? commodities : []).filter((c) => c && c.isActive !== false)
  const id = selected?.commodityId != null ? String(selected.commodityId).trim() : ''
  if (!id || list.some((c) => String(c.id) === id)) return list
  const name = String(selected?.commodityName ?? '').trim()
  const shortName = String(selected?.shortName ?? selected?.commodityShortName ?? '').trim()
  return [
    ...list,
    {
      id,
      name: name || shortName || id,
      shortName,
      materialCode: selected?.materialCode ?? '',
      isActive: false,
    },
  ]
}

/** Options for SearchableSingleSelect / DropdownMultiSelect. Active = Yes, plus one saved inactive row. */
export function commodityPickerOptions(commodities, selected) {
  return commodityDropdownOptions(commodities, selected).map((c) => ({
    value: String(c.id),
    label: commodityDropdownLabel(c),
    keywords: commoditySearchKeywords(c),
  }))
}
