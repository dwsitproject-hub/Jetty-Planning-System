/** Stable DB/API keys ↔ UI labels for Operational milestones (loading vs unloading). */

export const UNLOADING_MILESTONES = [
  { key: 'opening_hatch', label: 'OPENING' },
  { key: 'cargo_pre_conditioning', label: 'CARGO PRE-CONDITIONING' },
  { key: 'cargo_operations', label: 'CARGO OPERATIONS' },
  { key: 'other', label: 'OTHER' },
]

export const LOADING_MILESTONES = [
  { key: 'opening_hatch', label: 'OPENING' },
  { key: 'cargo_pre_conditioning', label: 'CARGO PRE-CONDITIONING' },
  { key: 'cargo_operations', label: 'CARGO OPERATIONS' },
  { key: 'other', label: 'OTHER' },
]

const ALL_KEYS = new Set([
  ...UNLOADING_MILESTONES.map((m) => m.key),
  ...LOADING_MILESTONES.map((m) => m.key),
])

export function getMilestoneListForPurpose(purpose) {
  return purpose === 'Unloading' ? UNLOADING_MILESTONES : LOADING_MILESTONES
}

export function milestoneKeyToLabel(key, purpose) {
  const list = getMilestoneListForPurpose(purpose)
  return list.find((m) => m.key === key)?.label || String(key || '').replace(/_/g, ' ').toUpperCase()
}

export function milestoneLabelToKey(label, purpose) {
  const list = getMilestoneListForPurpose(purpose)
  return list.find((m) => m.label === label)?.key ?? null
}

export function isValidMilestoneKey(key) {
  return ALL_KEYS.has(String(key || ''))
}

/** Map API entries (camelCase) to UI model used by Operational milestone workspace + stage counts. */
export function viewModelFromOperationalEntries(entries, purpose) {
  const activities = []
  const naByLabel = {}
  for (const e of entries || []) {
    const et = e.entryType ?? e.entry_type
    if (et === 'milestone_na') {
      const mk = e.milestoneKey ?? e.milestone_key
      const label = milestoneKeyToLabel(mk, purpose)
      naByLabel[label] = {
        reason: e.reason ?? '',
        entryId: String(e.id),
      }
    } else if (et === 'activity') {
      const mk = e.milestoneKey ?? e.milestone_key
      const rawLines = e.cargoLoadLines ?? e.cargo_load_lines
      const cargoLoadLines = Array.isArray(rawLines)
        ? rawLines.map((l) => ({
            id: l.id != null ? String(l.id) : undefined,
            lineOrder: Number(l.lineOrder ?? l.line_order ?? 0),
            qty: l.qty != null && l.qty !== '' ? Number(l.qty) : null,
            startAt: l.startAt ?? l.start_at ?? null,
            endAt: l.endAt ?? l.end_at ?? null,
            asOfAt: l.asOfAt ?? l.as_of_at ?? null,
          }))
        : []
      let cargoMovedQty = null
      if (cargoLoadLines.length > 0) {
        cargoMovedQty = cargoLoadLines.reduce((s, l) => s + (Number.isFinite(l.qty) ? l.qty : 0), 0)
      } else if (e.cargoMovedQty != null && e.cargoMovedQty !== '') {
        cargoMovedQty = Number(e.cargoMovedQty)
      } else if (e.cargo_moved_qty != null && e.cargo_moved_qty !== '') {
        cargoMovedQty = Number(e.cargo_moved_qty)
      }
      activities.push({
        id: String(e.id),
        category: milestoneKeyToLabel(mk, purpose),
        subStepTitle: e.subStepTitle ?? e.sub_step_title ?? '',
        description: e.remark ?? '',
        startTime: e.startAt ?? e.start_at,
        endTime: e.endAt ?? e.end_at,
        cargoHandlingMethodId: e.cargoHandlingMethodId ?? e.cargo_handling_method_id ?? null,
        cargoLoadLines,
        cargoMovedQty,
      })
    }
  }
  return { activities, naByLabel }
}

export function operationalMilestoneDoneCount(purpose, activities, naByLabel) {
  const list = getMilestoneListForPurpose(purpose)
  return list.filter((m) => {
    if (naByLabel[m.label]?.reason) return true
    const rows = (activities || []).filter((a) => a.category === m.label)
    if (rows.length === 0) return false
    if (m.key === 'opening_hatch') {
      return rows.every((a) => Boolean(a.startTime) && a.cargoHandlingMethodId != null && a.cargoHandlingMethodId !== '')
    }
    if (m.key === 'cargo_pre_conditioning') {
      return rows.every((a) => Boolean(a.startTime))
    }
    return true
  }).length
}
