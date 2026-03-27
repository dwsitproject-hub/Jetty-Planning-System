/** Maps API sub_process_key → Pre-Checking section tab id (matches Loading.jsx). */
export const ACTIVITY_LOG_PRE_KEY_TO_SECTION = {
  key_meeting: 'keyMeeting',
  nor_accepted: 'norAccepted',
  tank_inspection: 'tankInspection',
  hold_inspection: 'holdInspection',
  sampling: 'sampling',
  initial_sounding: 'initialSounding',
  initial_draft_survey: 'initialDraftSurvey',
}

/** Maps API sub_process_key → Post-Checking section tab id. */
export const ACTIVITY_LOG_POST_KEY_TO_SECTION = {
  final_tank_inspection: 'finalTankInspection',
  final_hold_inspection: 'finalHoldInspection',
  final_sounding: 'finalSounding',
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
    return `${basePath}/${v}/loading?milestone=${encodeURIComponent(mk)}&edit=1`
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
