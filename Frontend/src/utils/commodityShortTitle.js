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
