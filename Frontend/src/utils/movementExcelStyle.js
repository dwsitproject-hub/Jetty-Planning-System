/**
 * Excel colours for the movement type cell (Normal / Kuras / Mixed), matching the screen tags:
 * green, amber and orange. The label text decides (Mixed may list its palkas, e.g. "Mixed (1B)").
 */
const STYLES = {
  normal: { fill: 'FFDCFCE7', font: 'FF166534' },
  kuras: { fill: 'FFFEF3C7', font: 'FF92400E' },
  mixed: { fill: 'FFFFEDD5', font: 'FF9A3412' },
}

/** 'normal' | 'kuras' | 'mixed' | null from a movement label. */
export function movementKindOfLabel(text) {
  const s = String(text || '').trim().toLowerCase()
  if (s.startsWith('mixed') || s.startsWith('campuran')) return 'mixed'
  if (s.startsWith('kuras')) return 'kuras'
  if (s.startsWith('normal')) return 'normal'
  return null
}

/** Colour one ExcelJS cell by its movement label; other text is left alone. */
export function applyMovementCellStyle(cell, text) {
  const kind = movementKindOfLabel(text)
  if (!kind) return
  const s = STYLES[kind]
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: s.fill } }
  cell.font = { color: { argb: s.font }, bold: true }
}
