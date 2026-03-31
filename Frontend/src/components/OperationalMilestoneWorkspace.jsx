import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  getMilestoneListForPurpose,
  milestoneLabelToKey,
  milestoneKeyToLabel,
  isValidMilestoneKey,
  viewModelFromOperationalEntries,
} from '../data/operationalMilestones'
import {
  fetchOperationalActivities,
  createOperationalEntry,
  deleteOperationalEntry,
  fetchCargoHandlingMethods,
} from '../api/operations'
import OperationActivityTimeline from './OperationActivityTimeline'

const OPERATIONAL_RAIL_COLLAPSED_KEY = 'jps_operational_milestone_rail_collapsed'

function readBool(key, fallback = false) {
  try {
    const v = localStorage.getItem(key)
    if (v === '1') return true
    if (v === '0') return false
    return fallback
  } catch {
    return fallback
  }
}

function writeBool(key, value) {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function getNowForDateTimeLocal() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day}T${h}:${min}`
}

const SHORT_CODE = {
  'OPENING H1 & H2': 'OP',
  'CARGO PRE-CONDITIONING': 'CPC',
  'CARGO OPERATIONS': 'COP',
  OTHER: 'OT',
}

function milestoneActivitiesFor(activities, category) {
  return (activities || []).filter((a) => a.category === category)
}

function deriveMilestoneDisplay(category, activities, naMap) {
  const na = naMap?.[category]
  if (na?.reason) {
    return { label: 'N/A', dotClass: 'na', statusClass: 'na' }
  }
  const rows = milestoneActivitiesFor(activities, category)
  if (rows.length === 0) {
    return { label: 'Not started', dotClass: 'not-started', statusClass: 'not-started' }
  }
  const anyOpen = rows.some((a) => !a.endTime)
  if (anyOpen) {
    return { label: 'In progress', dotClass: 'in-progress', statusClass: 'in-progress' }
  }
  return { label: 'Done', dotClass: 'done', statusClass: 'done' }
}

function formatDurationLabel(startIso, endIso) {
  if (!startIso || !endIso) return '—'
  const a = new Date(startIso).getTime()
  const b = new Date(endIso).getTime()
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return '—'
  const mins = Math.round((b - a) / 60000)
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}h ${m}m`
}

/**
 * Operational tab: milestone rail + composer; unified timeline below (all phases).
 * API-backed when `operationId` is set; otherwise uses LoadingContext callbacks.
 */
export default function OperationalMilestoneWorkspace({
  vesselId,
  basePath,
  purpose,
  operationId = null,
  loadingOp,
  addActivity,
  setOperationalMilestoneNa,
  onOperationalSaved,
  activityLogRefresh = 0,
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const useApi = operationId != null
  const milestoneDefs = getMilestoneListForPurpose(purpose)
  const milestones = milestoneDefs.map((m) => m.label)
  const shortCodes = SHORT_CODE

  const [apiActivities, setApiActivities] = useState([])
  const [apiNaMap, setApiNaMap] = useState({})
  const [apiLoadError, setApiLoadError] = useState(null)

  const loadApi = useCallback(async () => {
    if (!useApi) return
    setApiLoadError(null)
    try {
      const data = await fetchOperationalActivities(operationId)
      const vm = viewModelFromOperationalEntries(data?.entries || [], purpose)
      setApiActivities(vm.activities)
      setApiNaMap(vm.naByLabel)
    } catch (e) {
      setApiLoadError(e?.message || 'Failed to load operational data')
      setApiActivities([])
      setApiNaMap({})
    }
  }, [useApi, operationId, purpose])

  useEffect(() => {
    loadApi()
  }, [loadApi])

  useEffect(() => {
    if (useApi) loadApi()
  }, [useApi, activityLogRefresh, loadApi])

  const activities = useApi ? apiActivities : loadingOp?.activities || []
  const naMap = useApi ? apiNaMap : loadingOp?.milestoneNa || {}

  const [listCollapsed, setListCollapsed] = useState(() => readBool(OPERATIONAL_RAIL_COLLAPSED_KEY, false))
  useEffect(() => writeBool(OPERATIONAL_RAIL_COLLAPSED_KEY, listCollapsed), [listCollapsed])

  const [activeMilestone, setActiveMilestone] = useState(() => milestones[0] || '')
  useEffect(() => {
    if (!milestones.includes(activeMilestone)) setActiveMilestone(milestones[0] || '')
  }, [milestones, activeMilestone])

  useEffect(() => {
    const mk = searchParams.get('milestone')
    if (!mk || !isValidMilestoneKey(mk)) return
    const label = milestoneKeyToLabel(mk, purpose)
    const defs = getMilestoneListForPurpose(purpose)
    if (!defs.some((d) => d.label === label)) return
    setActiveMilestone(label)
    setFormError('')
    if (searchParams.get('edit') === '1') {
      setFormModalOpen(true)
    }
    const next = new URLSearchParams(searchParams)
    next.delete('milestone')
    next.delete('edit')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams, purpose])

  const [subStepTitle, setSubStepTitle] = useState('')
  const [cargoHandlingMethodId, setCargoHandlingMethodId] = useState('')
  const [cargoHandlingMethods, setCargoHandlingMethods] = useState([])
  const [remark, setRemark] = useState('')
  const [startTime, setStartTime] = useState(() => getNowForDateTimeLocal())
  const [endTime, setEndTime] = useState('')
  const [formError, setFormError] = useState('')
  const [formModalOpen, setFormModalOpen] = useState(false)

  const [actionToast, setActionToast] = useState(null)

  const [naModal, setNaModal] = useState(null)
  const [naReason, setNaReason] = useState('')

  useEffect(() => {
    if (!actionToast?.message) return undefined
    const t = window.setTimeout(() => setActionToast(null), 6500)
    return () => clearTimeout(t)
  }, [actionToast])

  useEffect(() => {
    if (!useApi) return
    fetchCargoHandlingMethods()
      .then((rows) => setCargoHandlingMethods(Array.isArray(rows) ? rows : []))
      .catch(() => setCargoHandlingMethods([]))
  }, [useApi])

  useEffect(() => {
    if (!naModal) return undefined
    const t = window.setTimeout(() => {
      document.getElementById('op-na-reason')?.focus()
    }, 50)
    return () => window.clearTimeout(t)
  }, [naModal])

  const bumpSaved = () => onOperationalSaved?.()

  const selectMilestone = (cat) => {
    setActiveMilestone(cat)
    setFormError('')
  }

  const openFormModal = (cat = activeMilestone) => {
    selectMilestone(cat)
    setFormModalOpen(true)
  }

  const openNaModal = (cat) => {
    setNaModal(cat)
    setNaReason('')
  }

  const closeNaModal = () => {
    setNaModal(null)
    setNaReason('')
  }

  const confirmNa = async () => {
    if (!naModal) return
    const r = naReason.trim()
    if (!r) return
    const key = milestoneLabelToKey(naModal, purpose)
    if (!key) {
      setFormError('Invalid milestone')
      return
    }
    if (useApi) {
      try {
        await createOperationalEntry(operationId, {
          entryType: 'milestone_na',
          milestoneKey: key,
          reason: r,
        })
        await loadApi()
        bumpSaved()
        setActionToast({ message: `Marked ${naModal} as N/A.`, variant: 'success' })
      } catch (e) {
        setFormError(e?.message || 'Failed to save N/A')
        return
      }
    } else {
      setOperationalMilestoneNa(vesselId, naModal, { reason: r })
      setActionToast({ message: `Marked ${naModal} as N/A.`, variant: 'success' })
    }
    closeNaModal()
    if (activeMilestone === naModal) selectMilestone(naModal)
  }

  const milestoneClosedCount = useMemo(() => {
    return milestones.filter((cat) => {
      if (naMap[cat]?.reason) return true
      return milestoneActivitiesFor(activities, cat).length > 0
    }).length
  }, [milestones, naMap, activities])

  function syncFormFromMilestone(cat) {
    setSubStepTitle('')
    setCargoHandlingMethodId('')
    setRemark('')
    setStartTime(getNowForDateTimeLocal())
    setEndTime('')
    setFormError('')
    if (cat && milestones.includes(cat)) setActiveMilestone(cat)
  }

  const resetComposerAfterAdd = (keepMilestone) => {
    const m = keepMilestone || activeMilestone
    setSubStepTitle('')
    setCargoHandlingMethodId('')
    setRemark('')
    setStartTime(getNowForDateTimeLocal())
    setEndTime('')
    setFormError('')
    if (m) setActiveMilestone(m)
  }

  const validateAndBuildPayload = (cat, sub, rem, st, en, methodId) => {
    const c = String(cat || '').trim()
    if (!c) return { error: 'Select a milestone.' }
    const remarkTrim = String(rem || '').trim()
    if (!remarkTrim) return { error: 'Remark is required.' }
    if (!st || !en) return { error: 'Start time and end time are required.' }
    const ta = new Date(st).getTime()
    const tb = new Date(en).getTime()
    if (Number.isNaN(ta) || Number.isNaN(tb)) return { error: 'Invalid date or time.' }
    if (tb < ta) return { error: 'End time must be after start time.' }
    const mk = milestoneLabelToKey(c, purpose)
    if (!mk) return { error: 'Invalid milestone.' }
    if (mk === 'cargo_operations') {
      const mid = parseInt(methodId, 10)
      if (!Number.isFinite(mid)) return { error: 'Cargo handling method is required.' }
    }
    return {
      payload: {
        milestoneKey: mk,
        subStepTitle: String(sub || '').trim(),
        description: remarkTrim,
        startTime: st,
        endTime: en,
        cargoHandlingMethodId: mk === 'cargo_operations' ? parseInt(methodId, 10) : null,
      },
    }
  }

  const handleAdd = async (andAnother = false) => {
    const { error, payload } = validateAndBuildPayload(
      activeMilestone,
      subStepTitle,
      remark,
      startTime,
      endTime,
      cargoHandlingMethodId
    )
    if (error) {
      setFormError(error)
      return
    }
    if (useApi) {
      try {
        await createOperationalEntry(operationId, {
          entryType: 'activity',
          milestoneKey: payload.milestoneKey,
          subStepTitle: payload.subStepTitle,
          remark: payload.description,
          startAt: new Date(payload.startTime).toISOString(),
          endAt: new Date(payload.endTime).toISOString(),
          cargoHandlingMethodId: payload.cargoHandlingMethodId,
        })
        await loadApi()
        bumpSaved()
        setActionToast({
          message: andAnother ? 'Activity saved. Add another below.' : 'Activity saved.',
          variant: 'success',
        })
      } catch (e) {
        setFormError(e?.message || 'Failed to save activity')
        return
      }
    } else {
      addActivity(vesselId, {
        category: activeMilestone,
        subStepTitle: payload.subStepTitle,
        description: payload.description,
        startTime: payload.startTime,
        endTime: payload.endTime,
        cargoHandlingMethodId: payload.cargoHandlingMethodId,
      })
      setActionToast({
        message: andAnother ? 'Activity saved. Add another below.' : 'Activity saved.',
        variant: 'success',
      })
    }
    if (andAnother) resetComposerAfterAdd(activeMilestone)
    else {
      syncFormFromMilestone(activeMilestone)
      setFormModalOpen(false)
    }
  }

  const clearNa = async () => {
    const na = naMap[activeMilestone]
    if (!na?.reason) return
    if (useApi) {
      const entryId = na.entryId
      if (!entryId) return
      try {
        await deleteOperationalEntry(operationId, entryId)
        await loadApi()
        bumpSaved()
        setActionToast({ message: 'N/A cleared. You can add activities for this milestone.', variant: 'success' })
      } catch (e) {
        setFormError(e?.message || 'Failed to clear N/A')
      }
    } else {
      setOperationalMilestoneNa(vesselId, activeMilestone, null)
      setActionToast({ message: 'N/A cleared. You can add activities for this milestone.', variant: 'success' })
    }
  }

  const activeRows = milestoneActivitiesFor(activities, activeMilestone)
  const activeDisplay = deriveMilestoneDisplay(activeMilestone, activities, naMap)
  const canMarkNa = activeMilestone && !naMap[activeMilestone]?.reason && activeRows.length === 0

  return (
    <>
      <div className="precheck-sections">
        {actionToast?.message && (
          <div
            className={`toast ${actionToast.variant === 'error' ? 'toast--warning' : 'toast--success'}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span className="toast__icon" aria-hidden>
              {actionToast.variant === 'error' ? '!' : '✓'}
            </span>
            <p className="toast__message">{actionToast.message}</p>
            <button type="button" className="toast__close" onClick={() => setActionToast(null)} aria-label="Dismiss notification">
              ×
            </button>
          </div>
        )}
        {apiLoadError && (
          <p className="operational-form-error" role="alert">
            {apiLoadError}
          </p>
        )}
        <div className="precheck-master-detail">
          <aside className={`precheck-master-detail__list ${listCollapsed ? 'precheck-master-detail__list--collapsed' : ''}`}>
          <div className="precheck-checklist-header">
            <span className="precheck-checklist-header__title">Operational steps</span>
            <button
              type="button"
              className="btn btn--secondary btn--small loading-process-rail__collapse precheck-checklist-header__collapse"
              onClick={() => setListCollapsed((c) => !c)}
              aria-label={listCollapsed ? 'Expand operational steps navigation' : 'Collapse operational steps navigation'}
              title={listCollapsed ? 'Expand steps' : 'Collapse steps'}
            >
              <span className="rail-chevron" aria-hidden>
                {listCollapsed ? '›' : '‹'}
              </span>
            </button>
          </div>

          <div className={`precheck-checklist ${listCollapsed ? 'precheck-checklist--collapsed' : ''}`} role="tablist" aria-label="Operational milestones">
            {milestones.map((cat) => {
              const st = deriveMilestoneDisplay(cat, activities, naMap)
              const code = shortCodes[cat] || cat.slice(0, 4)
              const title = `${cat} · ${st.label}`
              const rowCount = milestoneActivitiesFor(activities, cat).length
              const subtitle =
                st.statusClass === 'na'
                  ? 'Marked N/A'
                  : rowCount > 0
                    ? `${rowCount} activit${rowCount === 1 ? 'y' : 'ies'}`
                    : null
              return (
                <div
                  key={cat}
                  className={`precheck-checklist__item ${activeMilestone === cat ? 'precheck-checklist__item--active' : ''}`}
                  title={title}
                >
                  {listCollapsed ? (
                    <button type="button" className="precheck-checklist__compact-btn" onClick={() => selectMilestone(cat)} aria-label={title}>
                      <span className={`precheck-status-dot precheck-status-dot--${st.dotClass}`} aria-hidden />
                      <span className="precheck-checklist__code" aria-hidden>{code}</span>
                    </button>
                  ) : (
                    <>
                      <div className="precheck-checklist__left">
                        <div className="precheck-checklist__topline">
                          <span className="precheck-checklist__title">{cat}</span>
                          <span className={`precheck-checklist__status precheck-checklist__status--${st.statusClass}`}>{st.label}</span>
                        </div>
                        {subtitle ? <span className="precheck-checklist__saved">{subtitle}</span> : null}
                      </div>
                      <button type="button" className="btn btn--small" onClick={() => openFormModal(cat)}>
                        Open
                      </button>
                    </>
                  )}
                </div>
              )
            })}
          </div>

          {!listCollapsed && (
            <p className="operational-milestone-progress" aria-live="polite">
              Milestones with activity or N/A: <strong>{milestoneClosedCount}</strong> / {milestones.length}
            </p>
          )}
          </aside>

          <div className="precheck-sections operational-milestone-detail">
            <OperationActivityTimeline
              operationId={useApi ? operationId : null}
              refreshToken={activityLogRefresh}
              vesselId={vesselId}
              basePath={basePath}
              onActivityLogRefresh={onOperationalSaved}
            />
            {formModalOpen ? (
              <div className="modal-overlay" onClick={() => setFormModalOpen(false)} aria-hidden="true">
                <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Operational form">
                  <section className="berthing-modal__card loading-tab-card operational-milestone-composer">
            <h3 className="berthing-modal__card-title operational-milestone-composer__title" id="op-milestone-active-label">
              {activeMilestone}
            </h3>
            {activeMilestone === 'CARGO PRE-CONDITIONING' ? (
              <p className="operational-milestone-composer__subtitle text-steel">
                Capture pre-operation readiness: preparation, condition checks, and pre-transfer notes in the remark field.
              </p>
            ) : null}
            {activeDisplay.statusClass === 'na' ? (
              <p className="operational-milestone-composer__subtitle operational-milestone-active__na">
                This milestone is marked N/A — add an activity only if you are correcting that.
              </p>
            ) : null}

            <div className="berthing-modal__field">
              <label className="berthing-modal__label" htmlFor="op-sub-step">
                Sub-step title (optional)
              </label>
              <input
                id="op-sub-step"
                type="text"
                className="berthing-modal__input"
                value={subStepTitle}
                onChange={(e) => setSubStepTitle(e.target.value)}
                placeholder="e.g. Second hose connection, leak check"
              />
            </div>
            {activeMilestone === 'CARGO OPERATIONS' ? (
              <div className="berthing-modal__field">
                <label className="berthing-modal__label" htmlFor="op-handling-method">
                  Cargo Handling Method <span className="required-star">*</span>
                </label>
                <select
                  id="op-handling-method"
                  className="berthing-modal__input"
                  value={cargoHandlingMethodId}
                  onChange={(e) => setCargoHandlingMethodId(e.target.value)}
                >
                  <option value="">Select method</option>
                  {cargoHandlingMethods.map((m) => (
                    <option key={m.id} value={String(m.id)}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="berthing-modal__field">
              <label className="berthing-modal__label" htmlFor="op-remark">
                Remark <span className="required-star">*</span>
              </label>
              <textarea
                id="op-remark"
                className="berthing-modal__input berthing-modal__textarea"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="What happened, evidence, or handover note"
                rows={3}
              />
            </div>

            <div className="loading-detail-activity-times">
              <div className="berthing-modal__field">
                <label className="berthing-modal__label">
                  Start time <span className="required-star">*</span>
                </label>
                <input
                  type="datetime-local"
                  className="berthing-modal__input"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div className="berthing-modal__field">
                <label className="berthing-modal__label">
                  End time <span className="required-star">*</span>
                </label>
                <input
                  type="datetime-local"
                  className="berthing-modal__input"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>

            {startTime && endTime ? (
              <p className="operational-duration-hint">
                Duration: <strong>{formatDurationLabel(startTime, endTime)}</strong>
              </p>
            ) : null}

            {formError ? (
              <p className="operational-form-error" role="alert">
                {formError}
              </p>
            ) : null}

            <div className="operational-milestone-actions loading-step-card__actions">
              <button type="button" className="btn btn--primary btn--small" onClick={() => handleAdd(false)}>
                Save
              </button>
              <button type="button" className="btn btn--small btn--soft" onClick={() => handleAdd(true)}>
                Save &amp; add another
              </button>
            </div>

            {canMarkNa ? (
              <div className="operational-na-actions">
                <button type="button" className="btn btn--small btn--soft" onClick={() => openNaModal(activeMilestone)}>
                  Mark “{activeMilestone}” as N/A…
                </button>
              </div>
            ) : null}
            {activeMilestone && naMap[activeMilestone]?.reason ? (
              <div className="operational-na-banner">
                <p>
                  <strong>N/A:</strong> {naMap[activeMilestone].reason}
                </p>
                <button type="button" className="btn btn--small" onClick={() => clearNa()}>
                  Clear N/A
                </button>
              </div>
            ) : null}
                  </section>
                </div>
              </div>
            ) : null}
        </div>
        </div>
      </div>

      {naModal ? (
        <div className="modal-overlay" onClick={closeNaModal} aria-hidden="true">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="op-na-title">
            <h2 id="op-na-title" className="modal__title">
              Mark milestone as N/A
            </h2>
            <p className="modal__section text-steel">
              <strong>{naModal}</strong> — explain why this milestone does not apply (audit trail).
            </p>
            <div className="modal__section">
              <label htmlFor="op-na-reason" className="modal__label">
                Reason <span className="required-star">*</span>
              </label>
              <textarea
                id="op-na-reason"
                className="modal__input berthing-modal__textarea"
                rows={3}
                value={naReason}
                onChange={(e) => setNaReason(e.target.value)}
                placeholder="e.g. Liquid product — no separate comm/compl discharge per procedure"
              />
            </div>
            <div className="modal__footer">
              <button type="button" className="btn btn--ghost" onClick={closeNaModal}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" onClick={() => confirmNa()} disabled={!naReason.trim()}>
                Confirm N/A
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
