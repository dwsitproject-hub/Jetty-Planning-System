/** Maps API sub_process_key → Pre-Checking section tab id (matches Loading.jsx). */
export const ACTIVITY_LOG_PRE_KEY_TO_SECTION = {
  key_meeting: 'keyMeeting',
  nor_accepted: 'norAccepted',
  inspection: 'inspection',
  tank_inspection: 'inspection',
  hold_inspection: 'inspection',
  sampling: 'sampling',
  initial_cargo_checking: 'initialCargoChecking',
  initial_sounding: 'initialCargoChecking',
  initial_draft_survey: 'initialCargoChecking',
}

/** Maps API sub_process_key → Post-Checking section tab id. */
export const ACTIVITY_LOG_POST_KEY_TO_SECTION = {
  final_inspection: 'finalInspection',
  final_tank_inspection: 'finalInspection',
  final_hold_inspection: 'finalInspection',
  final_sounding: 'finalCargoChecking',
}

/**
 * Build URL to open the at-berth editor for one timeline row (Loading / Unloading routes).
 * @returns {string|null} pathname + query, or null if not editable from UI
 */
export function buildActivityLogEditPath(ev, { vesselId, basePath }) {
  if (!vesselId || !basePath) return null
  const v = encodeURIComponent(vesselId)

  if (ev.source === 'sub_process') {
    const phase = ev.phase
    const key = ev.subProcessKey
    if (phase === 'Pre-Checking') {
      const sec = ACTIVITY_LOG_PRE_KEY_TO_SECTION[key]
      if (!sec) return null
      return `${basePath}/${v}/pre-checking?focus=${encodeURIComponent(sec)}&edit=1`
    }
    if (phase === 'Post-Checking') {
      const sec = ACTIVITY_LOG_POST_KEY_TO_SECTION[key]
      if (!sec) return null
      return `${basePath}/${v}/post-checking?focus=${encodeURIComponent(sec)}&edit=1`
    }
    return null
  }

  if (ev.source === 'operational_activity' || ev.source === 'operational_milestone_na') {
    const mk = ev.milestoneKey
    if (!mk) return null
    const q = new URLSearchParams()
    q.set('milestone', mk)
    q.set('edit', '1')
    if (ev.source === 'operational_activity') {
      const m = /^op-(\d+)$/.exec(String(ev.id || ''))
      if (m) q.set('entryId', m[1])
      if (ev.subStepTitle) q.set('subStepTitle', String(ev.subStepTitle))
      if (ev.remark) q.set('remark', String(ev.remark))
      if (ev.startAt) q.set('startAt', String(ev.startAt))
      if (ev.endAt) q.set('endAt', String(ev.endAt))
    }
    return `${basePath}/${v}/loading?${q.toString()}`
  }

  return null
}

export function activityLogRowCanDelete(ev) {
  return (
    ev.source === 'sub_process' ||
    ev.source === 'operational_activity' ||
    ev.source === 'operational_milestone_na'
  )
}
