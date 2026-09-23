/** Milestones where end time is optional / not used in the capture UI (matches backend). */
export const START_ONLY_MILESTONE_KEYS = new Set(['opening_hatch', 'cargo_pre_conditioning'])

function lineStartAt(line) {
  return line?.startAt ?? line?.startedAt ?? null
}

function lineEndAt(line) {
  return line?.endAt ?? line?.endedAt ?? null
}

function hasCargoHandlingMethod(ev) {
  const id = ev.cargoHandlingMethodId ?? ev.cargo_handling_method_id
  if (id != null && id !== '') return true
  const name = ev.cargoHandlingMethodName ?? ev.cargo_handling_method_name
  return Boolean(name && String(name).trim())
}

function cargoOperationsEventStatus(ev) {
  const lines = Array.isArray(ev.cargoLoadLines) ? ev.cargoLoadLines : []
  const openLine = lines.some((l) => lineStartAt(l) && !lineEndAt(l))
  if (openLine) return 'In progress'
  if (ev.endAt) return 'Done'
  if (lines.some((l) => lineStartAt(l) && lineEndAt(l))) return 'Done'
  if (ev.startAt && lines.length === 0) return 'In progress'
  if (ev.startAt) return 'Done'
  return '—'
}

function openingHatchEventStatus(ev) {
  if (ev.startAt && hasCargoHandlingMethod(ev)) return 'Done'
  if (ev.startAt) return 'In progress'
  return '—'
}

/**
 * Resolve display status for a timeline event (activity-timeline API shape).
 * Labels: Done | In progress | N/A | —
 */
export function operationalActivityEventStatus(ev) {
  if (!ev) return '—'
  if (ev.source === 'operational_milestone_na') return 'N/A'
  if (ev.source === 'sub_process') {
    const s = ev.status != null ? String(ev.status).trim() : ''
    return s || '—'
  }
  if (ev.source !== 'operational_activity') return '—'

  const mk = ev.milestoneKey ?? ev.milestone_key ?? null
  if (mk === 'opening_hatch') return openingHatchEventStatus(ev)
  if (mk === 'cargo_pre_conditioning') {
    if (ev.startAt) return 'Done'
    return '—'
  }
  if (mk === 'cargo_operations') return cargoOperationsEventStatus(ev)
  if (ev.endAt) return 'Done'
  if (ev.startAt) return 'In progress'
  return '—'
}

/** Timeline UI uses title case for in-progress label. */
export function operationalActivityEventStatusForTimeline(ev) {
  const s = operationalActivityEventStatus(ev)
  if (s === 'In progress') return 'In Progress'
  return s
}
