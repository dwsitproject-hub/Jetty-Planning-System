import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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
  updateOperationalEntry,
  deleteOperationalEntry,
  fetchOperationalProgress,
} from '../api/operations'
import { fetchMasterTanks } from '../api/masterTanks'
import { fetchTankGaugingMassDelta } from '../api/tankGauging'
import { readAtgQtyFromRef } from '../utils/atgQty.js'
import OperationActivityTimeline from './OperationActivityTimeline'
import DropdownMultiSelect from './DropdownMultiSelect'
import CargoLiveMovementPanel from './CargoLiveMovementPanel'
import {
  collectCargoLoadLines,
  detectCargoSiQtyMismatch,
  formatCargoSiQtyMismatchBanner,
  formatCargoSiQtyMismatchConfirm,
} from '../utils/cargoSiQtyMismatch.js'
import {
  buildLiveCargoProgressSnapshot,
  findOpenCargoLoadLine,
  partitionDraftTanks,
  resolveCargoProgressTotalLoaded,
  resolveDefaultCargoOperationWindowStart,
  sumClosedPersistedLineQty,
} from '../utils/cargoSessionHelpers.js'
import {
  ensureApiStartAfterPreviousEnd,
  getScheduleEntryTimeZone,
  normalizeForApi,
  nowToNaiveLocalInScheduleZone,
  utcIsoToNaiveLocal,
} from '../utils/scheduleDateTime.js'
import {
  MAX_ACTIVITY_REMARK_CHARS,
  MAX_MILESTONE_REASON_CHARS,
  MAX_MILESTONE_SUBSTEP_TITLE_CHARS,
} from '../constants/inputLimits'

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

const SHORT_CODE = {
  OPENING: 'OH',
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
  if (category === 'OPENING') {
    const allComplete = rows.every(
      (a) =>
        a.startTime &&
        a.cargoHandlingMethodId != null &&
        a.cargoHandlingMethodId !== ''
    )
    if (allComplete) return { label: 'Done', dotClass: 'done', statusClass: 'done' }
    const anyStarted = rows.some((a) => a.startTime)
    if (anyStarted) return { label: 'In progress', dotClass: 'in-progress', statusClass: 'in-progress' }
    return { label: 'Not started', dotClass: 'not-started', statusClass: 'not-started' }
  }
  if (category === 'CARGO PRE-CONDITIONING') {
    const allStarted = rows.every((a) => a.startTime)
    if (allStarted) return { label: 'Done', dotClass: 'done', statusClass: 'done' }
    return { label: 'In progress', dotClass: 'in-progress', statusClass: 'in-progress' }
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

/** Parse user quantity; accepts comma as decimal separator. */
function parsePositiveQty(s) {
  if (s == null || String(s).trim() === '') return NaN
  const n = Number(String(s).trim().replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : NaN
}

function newCargoLineDraftKey() {
  return `cl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function defaultCargoLineDraft(getEnd, activityStartLocal, tankIds = []) {
  const endVal = getEnd()
  const startVal = activityStartLocal != null && activityStartLocal !== '' ? activityStartLocal : ''
  const sameMinute =
    startVal &&
    endVal &&
    String(startVal).slice(0, 16) === String(endVal).slice(0, 16)
  return {
    key: newCargoLineDraftKey(),
    qty: '',
    manualQty: '',
    atgQtyMode: 'auto',
    start: startVal,
    end: sameMinute ? '' : endVal,
    qtyTouched: false,
    tankIds: Array.isArray(tankIds) ? tankIds.map(String) : [],
  }
}

/** Sum line qty (or legacy cargoMovedQty) on other CARGO OPERATIONS activities. */
function sumCargoQtyOnOtherActivities(rows, excludeId) {
  return rows.reduce((s, r) => {
    if (excludeId && String(r.id) === String(excludeId)) return s
    const lines = r.cargoLoadLines
    if (Array.isArray(lines) && lines.length) {
      return (
        s +
        lines.reduce((t, l) => t + (Number.isFinite(Number(l.qty)) ? Number(l.qty) : 0), 0)
      )
    }
    return s + (Number.isFinite(Number(r.cargoMovedQty)) ? Number(r.cargoMovedQty) : 0)
  }, 0)
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
  /** Solid | Liquid — drives read-only Conveyor/Hose for Opening (server persists). */
  commodityType = 'Liquid',
  /** IANA zone for interpreting datetime-local values (defaults to browser device zone). */
  scheduleIana = getScheduleEntryTimeZone(),
  /** From GET /operations/:id — primary SI breakdown qty + metric (Cargo Operations form). */
  cargoSiQty = null,
  cargoSiMetricCode = null,
  cargoSiMetricName = null,
  /** SI commodity name from GET /operations/:id (read-only context for Cargo Operations). */
  cargoCommodity = null,
  /** Operation port id — filters shore tanks for liquid Cargo Operations. */
  portId = null,
  /** TB (time alongside) — default operation window for first Cargo Operations entry. */
  operationTbAt = null,
}) {
  const { t } = useTranslation('pages')
  const tz = scheduleIana?.trim() || getScheduleEntryTimeZone()
  const isoOrDatetimeToLocal = useCallback((value) => utcIsoToNaiveLocal(value, tz), [tz])
  const getNowForDateTimeLocal = useCallback(() => nowToNaiveLocalInScheduleZone(tz), [tz])
  const [searchParams, setSearchParams] = useSearchParams()
  const useApi = operationId != null
  const milestoneDefs = getMilestoneListForPurpose(purpose)
  const milestones = milestoneDefs.map((m) => m.label)
  const shortCodes = SHORT_CODE
  const openingHandlingLabel = commodityType === 'Solid' ? 'Conveyor' : 'Hose'

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

  const getDefaultCargoWindowStart = useCallback(() => {
    const priorStarts = []
    for (const label of ['OPENING', 'CARGO PRE-CONDITIONING']) {
      for (const row of milestoneActivitiesFor(activities, label)) {
        if (row.startTime) priorStarts.push(isoOrDatetimeToLocal(row.startTime))
      }
    }
    return resolveDefaultCargoOperationWindowStart({
      tbIso: operationTbAt,
      priorMilestoneStarts: priorStarts,
      getNowLocal: getNowForDateTimeLocal,
      toLocal: isoOrDatetimeToLocal,
    })
  }, [activities, operationTbAt, getNowForDateTimeLocal, isoOrDatetimeToLocal])

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
      const entryId = String(searchParams.get('entryId') || '').trim()
      const row = entryId ? (activities || []).find((a) => String(a.id) === entryId) : null
      setEditingEntryId(entryId || null)
      setSubStepTitle(row?.subStepTitle || String(searchParams.get('subStepTitle') || ''))
      setRemark(row?.description || String(searchParams.get('remark') || ''))
      setStartTime(isoOrDatetimeToLocal(row?.startTime || searchParams.get('startAt')) || getNowForDateTimeLocal())
      setEndTime(isoOrDatetimeToLocal(row?.endTime || searchParams.get('endAt')) || '')
      const lines = row?.cargoLoadLines
      const fallbackTankIds = Array.isArray(row?.tankIds) ? row.tankIds.map(String) : []
      if (Array.isArray(lines) && lines.length > 0) {
        setCargoLoadLinesDraft(
          lines.map((l) => {
            let startLoc = l.startAt ? isoOrDatetimeToLocal(l.startAt) : ''
            let endLoc = l.endAt ? isoOrDatetimeToLocal(l.endAt) : ''
            if (!endLoc && l.asOfAt) {
              endLoc = isoOrDatetimeToLocal(l.asOfAt)
              if (!startLoc) startLoc = isoOrDatetimeToLocal(row?.startTime) || ''
            } else if (!startLoc && row?.startTime) {
              startLoc = isoOrDatetimeToLocal(row.startTime)
            }
            const lineTankIds =
              Array.isArray(l.tankIds) && l.tankIds.length > 0
                ? l.tankIds.map(String)
                : fallbackTankIds
            return {
              key: l.id || newCargoLineDraftKey(),
              qty: Number.isFinite(Number(l.qty)) ? String(l.qty) : '',
              manualQty:
                l.manualQty != null && Number.isFinite(Number(l.manualQty)) ? String(l.manualQty) : '',
              atgQtyMode: l.atgQtyMode === 'manual' ? 'manual' : 'auto',
              loadedManual: l.atgQtyMode === 'manual',
              start: startLoc,
              end: endLoc,
              qtyTouched: true,
              tankIds: lineTankIds,
            }
          })
        )
      } else if (
        row?.cargoMovedQty != null &&
        row?.cargoMovedQty !== '' &&
        Number.isFinite(Number(row.cargoMovedQty))
      ) {
        setCargoLoadLinesDraft([
          {
            key: 'legacy',
            qty: String(row.cargoMovedQty),
            manualQty: '',
            atgQtyMode: 'auto',
            start: isoOrDatetimeToLocal(row?.startTime) || '',
            end: isoOrDatetimeToLocal(row?.endTime || row?.startTime) || '',
            tankIds: Array.isArray(row?.tankIds) ? row.tankIds.map(String) : [],
          },
        ])
      } else {
        setCargoLoadLinesDraft([defaultCargoLineDraft(getNowForDateTimeLocal, getNowForDateTimeLocal())])
      }
      setFormModalOpen(true)
    } else {
      setEditingEntryId(null)
    }
    const next = new URLSearchParams(searchParams)
    next.delete('milestone')
    next.delete('edit')
    next.delete('entryId')
    next.delete('subStepTitle')
    next.delete('remark')
    next.delete('startAt')
    next.delete('endAt')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams, purpose, activities, isoOrDatetimeToLocal, getNowForDateTimeLocal])

  const [subStepTitle, setSubStepTitle] = useState('')
  const [remark, setRemark] = useState('')
  const [startTime, setStartTime] = useState(() => nowToNaiveLocalInScheduleZone(tz))
  const [endTime, setEndTime] = useState('')
  const [cargoLoadLinesDraft, setCargoLoadLinesDraft] = useState([])
  const [atgRefByLineKey, setAtgRefByLineKey] = useState({})
  const [masterTankOptions, setMasterTankOptions] = useState([])
  const [tankMetaById, setTankMetaById] = useState(() => new Map())
  const [editingEntryId, setEditingEntryId] = useState(null)
  const [formError, setFormError] = useState('')
  const [formModalOpen, setFormModalOpen] = useState(false)
  const [liveAtgTick, setLiveAtgTick] = useState(0)
  const [sessionOperationalProgress, setSessionOperationalProgress] = useState(null)

  useEffect(() => {
    if (commodityType !== 'Liquid' || portId == null || portId === '') {
      setMasterTankOptions([])
      setTankMetaById(new Map())
      return
    }
    let cancelled = false
    fetchMasterTanks(portId)
      .then((list) => {
        if (cancelled) return
        const meta = new Map()
        const opts = (Array.isArray(list) ? list : []).map((tk) => {
          const id = String(tk.id)
          const hasAtg = tk.hasAtg === true
          meta.set(id, { hasAtg, code: tk.code, name: tk.name })
          const base = tk.name ? `${tk.code} — ${tk.name}` : String(tk.code || tk.id)
          return {
            value: id,
            label: hasAtg ? `${base} · ATG` : base,
          }
        })
        setTankMetaById(meta)
        setMasterTankOptions(opts)
      })
      .catch(() => {
        if (!cancelled) {
          setMasterTankOptions([])
          setTankMetaById(new Map())
        }
      })
    return () => {
      cancelled = true
    }
  }, [commodityType, portId])

  const [actionToast, setActionToast] = useState(null)

  const [naModal, setNaModal] = useState(null)
  const [naReason, setNaReason] = useState('')

  useEffect(() => {
    if (!actionToast?.message) return undefined
    const t = window.setTimeout(() => setActionToast(null), 6500)
    return () => clearTimeout(t)
  }, [actionToast])

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

  const nextOpeningHatchLabel = useCallback(() => {
    const rows = milestoneActivitiesFor(activities, 'OPENING')
    const nums = rows.map((r) => {
      const m = /^H(\d+)$/i.exec(String(r.subStepTitle || '').trim())
      return m ? parseInt(m[1], 10) : 0
    })
    const max = nums.length ? Math.max(...nums) : 0
    return `H${max + 1}`
  }, [activities])

  const openFormModal = (cat = activeMilestone) => {
    selectMilestone(cat)
    setFormError('')

    // For CARGO OPERATIONS: if there is already an in-progress activity (no end time),
    // open that activity for editing instead of creating a blank new one.
    if (cat === 'CARGO OPERATIONS' && useApi) {
      const cargoRows = milestoneActivitiesFor(activities, 'CARGO OPERATIONS')
      // Prefer the most-recent in-progress entry (no endTime); fall back to last entry overall.
      const inProgress = cargoRows.find((r) => !r.endTime)
      const existing = inProgress ?? (cargoRows.length > 0 ? cargoRows[cargoRows.length - 1] : null)
      if (existing) {
        setEditingEntryId(existing.id)
        setRemark(existing.description || '')
        setStartTime(isoOrDatetimeToLocal(existing.startTime) || getNowForDateTimeLocal())
        setEndTime(existing.endTime ? isoOrDatetimeToLocal(existing.endTime) : '')
        const lines = existing.cargoLoadLines
        const fallbackTankIds = Array.isArray(existing.tankIds) ? existing.tankIds.map(String) : []
        if (Array.isArray(lines) && lines.length > 0) {
          setCargoLoadLinesDraft(
            lines.map((l) => ({
              key: l.id || newCargoLineDraftKey(),
              qty: l.qty != null && Number.isFinite(Number(l.qty)) ? String(l.qty) : '',
              manualQty:
                l.manualQty != null && Number.isFinite(Number(l.manualQty))
                  ? String(l.manualQty)
                  : '',
              atgQtyMode: l.atgQtyMode === 'manual' ? 'manual' : 'auto',
              loadedManual: l.atgQtyMode === 'manual',
              start: l.startAt ? isoOrDatetimeToLocal(l.startAt) : '',
              end: l.endAt ? isoOrDatetimeToLocal(l.endAt) : '',
              qtyTouched: true,
              tankIds:
                Array.isArray(l.tankIds) && l.tankIds.length > 0
                  ? l.tankIds.map(String)
                  : fallbackTankIds,
            }))
          )
        } else if (commodityType === 'Liquid' && useApi) {
          setCargoLoadLinesDraft([])
        } else {
          setCargoLoadLinesDraft([defaultCargoLineDraft(getNowForDateTimeLocal, isoOrDatetimeToLocal(existing.startTime) || getNowForDateTimeLocal())])
        }
        setFormModalOpen(true)
        return
      }
    }

    // Default: fresh new entry
    setEditingEntryId(null)
    setRemark('')
    const cargoRows = cat === 'CARGO OPERATIONS' ? milestoneActivitiesFor(activities, 'CARGO OPERATIONS') : []
    const t0 =
      cat === 'CARGO OPERATIONS' && cargoRows.length === 0
        ? getDefaultCargoWindowStart()
        : getNowForDateTimeLocal()
    setStartTime(t0)
    setEndTime('')
    if (cat === 'OPENING') {
      setSubStepTitle(nextOpeningHatchLabel())
    } else {
      setSubStepTitle('')
    }
    if (cat === 'CARGO OPERATIONS') {
      if (commodityType === 'Liquid' && useApi) {
        setCargoLoadLinesDraft([])
      } else {
        setCargoLoadLinesDraft([defaultCargoLineDraft(getNowForDateTimeLocal, t0)])
      }
    } else {
      setCargoLoadLinesDraft([])
    }
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
      const rows = milestoneActivitiesFor(activities, cat)
      if (rows.length === 0) return false
      if (cat === 'OPENING') {
        return rows.every(
          (a) =>
            a.startTime &&
            a.cargoHandlingMethodId != null &&
            a.cargoHandlingMethodId !== ''
        )
      }
      if (cat === 'CARGO PRE-CONDITIONING') {
        return rows.every((a) => a.startTime)
      }
      return true
    }).length
  }, [milestones, naMap, activities])

  function syncFormFromMilestone(cat) {
    setEditingEntryId(null)
    setSubStepTitle(cat === 'OPENING' ? nextOpeningHatchLabel() : '')
    setRemark('')
    const cargoRows = cat === 'CARGO OPERATIONS' ? milestoneActivitiesFor(activities, 'CARGO OPERATIONS') : []
    const t0 =
      cat === 'CARGO OPERATIONS' && cargoRows.length === 0
        ? getDefaultCargoWindowStart()
        : getNowForDateTimeLocal()
    setStartTime(t0)
    setEndTime('')
    if (cat === 'CARGO OPERATIONS') {
      if (commodityType === 'Liquid' && useApi) {
        setCargoLoadLinesDraft([])
      } else {
        setCargoLoadLinesDraft([defaultCargoLineDraft(getNowForDateTimeLocal, t0)])
      }
    } else {
      setCargoLoadLinesDraft([])
    }
    setFormError('')
    if (cat && milestones.includes(cat)) setActiveMilestone(cat)
  }

  const resetComposerAfterAdd = (keepMilestone) => {
    const m = keepMilestone || activeMilestone
    setEditingEntryId(null)
    setSubStepTitle(m === 'OPENING' ? nextOpeningHatchLabel() : '')
    setRemark('')
    const cargoRows = m === 'CARGO OPERATIONS' ? milestoneActivitiesFor(activities, 'CARGO OPERATIONS') : []
    const t0 =
      m === 'CARGO OPERATIONS' && cargoRows.length === 0
        ? getDefaultCargoWindowStart()
        : getNowForDateTimeLocal()
    setStartTime(t0)
    setEndTime('')
    if (m === 'CARGO OPERATIONS') {
      if (commodityType === 'Liquid' && useApi) {
        setCargoLoadLinesDraft([])
      } else {
        setCargoLoadLinesDraft([defaultCargoLineDraft(getNowForDateTimeLocal, t0)])
      }
    } else {
      setCargoLoadLinesDraft([])
    }
    setFormError('')
    if (m) setActiveMilestone(m)
  }

  const cargoOpsFormDerived = useMemo(() => {
    if (activeMilestone !== 'CARGO OPERATIONS') return null
    const siQty = cargoSiQty
    const metricLabel =
      [cargoSiMetricCode, cargoSiMetricName].filter(Boolean).join(' · ') || '—'
    const rows = useApi ? milestoneActivitiesFor(activities, 'CARGO OPERATIONS') : []
    const otherSum = useApi ? sumCargoQtyOnOtherActivities(rows, editingEntryId) : 0
    let basis = null
    if (siQty != null && siQty !== '' && Number.isFinite(Number(siQty))) {
      basis = Number(siQty) - otherSum
    }

    const sorted = cargoLoadLinesDraft.map((d, origIdx) => ({ d, origIdx })).sort((a, b) => {
      let ta = Number.POSITIVE_INFINITY
      let tb = Number.POSITIVE_INFINITY
      try {
        if (a.d.start) ta = new Date(normalizeForApi(a.d.start, tz)).getTime()
      } catch {
        ta = Number.POSITIVE_INFINITY
      }
      try {
        if (b.d.start) tb = new Date(normalizeForApi(b.d.start, tz)).getTime()
      } catch {
        tb = Number.POSITIVE_INFINITY
      }
      if (ta !== tb) return ta - tb
      return a.origIdx - b.origIdx
    })

    let runQty = 0
    const lineRows = sorted.map(({ d, origIdx }) => {
      const q = parsePositiveQty(d.qty)
      let startMs = NaN
      let endMs = NaN
      try {
        if (d.start) startMs = new Date(normalizeForApi(d.start, tz)).getTime()
      } catch {
        startMs = NaN
      }
      try {
        if (d.end) endMs = new Date(normalizeForApi(d.end, tz)).getTime()
      } catch {
        endMs = NaN
      }
      let ratePerHour = null
      if (Number.isFinite(q) && Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
        const h = (endMs - startMs) / 3600000
        if (h > 1e-9) ratePerHour = q / h
      }
      if (Number.isFinite(q)) runQty += q
      const balanceAfter =
        basis != null && Number.isFinite(basis) && Number.isFinite(runQty) ? basis - runQty : null
      return {
        key: d.key,
        origIdx,
        ratePerHour,
        balanceAfter,
      }
    })
    const lastBalance =
      lineRows.length && lineRows[lineRows.length - 1].balanceAfter != null
        ? lineRows[lineRows.length - 1].balanceAfter
        : basis
    const lastDraft = sorted.length ? sorted[sorted.length - 1].d : null
    const lastLineOpen = Boolean(lastDraft && lastDraft.start && !lastDraft.end)
    const canAddLine =
      !lastLineOpen &&
      (lastBalance == null || !Number.isFinite(lastBalance) || lastBalance > 1e-9)

    return { metricLabel, basis, lineRows, lastBalance, canAddLine, siQty, lastLineOpen }
  }, [
    activeMilestone,
    useApi,
    cargoSiQty,
    cargoSiMetricCode,
    cargoSiMetricName,
    activities,
    editingEntryId,
    cargoLoadLinesDraft,
    tz,
  ])

  const cargoQtyMismatch = useMemo(() => {
    if (activeMilestone !== 'CARGO OPERATIONS') return null
    const siQty = cargoSiQty
    if (siQty == null || !Number.isFinite(Number(siQty))) return null
    const rows = useApi ? milestoneActivitiesFor(activities, 'CARGO OPERATIONS') : []
    const lines = collectCargoLoadLines(rows, {
      excludeEntryId: editingEntryId,
      draftLines: cargoLoadLinesDraft,
    })
    return detectCargoSiQtyMismatch({ siQty: Number(siQty), lines })
  }, [activeMilestone, useApi, cargoSiQty, activities, editingEntryId, cargoLoadLinesDraft])

  const useCargoSessionMode =
    activeMilestone === 'CARGO OPERATIONS' && commodityType === 'Liquid' && useApi

  const openLineDraft = useMemo(
    () => cargoLoadLinesDraft.find((l) => l.start && !l.end) || null,
    [cargoLoadLinesDraft]
  )

  useEffect(() => {
    if (!useCargoSessionMode || !openLineDraft || !operationId) return undefined
    const id = window.setInterval(() => setLiveAtgTick((n) => n + 1), 30000)
    return () => window.clearInterval(id)
  }, [useCargoSessionMode, openLineDraft?.key, operationId])

  const openLoadLineId = useMemo(() => {
    if (!useApi) return null
    const rows = milestoneActivitiesFor(activities, 'CARGO OPERATIONS')
    for (const act of rows) {
      const open = findOpenCargoLoadLine(act.cargoLoadLines || [])
      if (open?.id) return String(open.id)
    }
    return null
  }, [useApi, activities])

  useEffect(() => {
    const shouldPoll =
      operationId &&
      useApi &&
      ((formModalOpen && useCargoSessionMode && openLineDraft) || openLoadLineId)
    if (!shouldPoll) {
      if (!openLoadLineId) setSessionOperationalProgress(null)
      return undefined
    }
    let cancelled = false
    const load = () => {
      fetchOperationalProgress(operationId)
        .then((res) => {
          if (!cancelled) setSessionOperationalProgress(res || null)
        })
        .catch(() => {
          if (!cancelled) setSessionOperationalProgress(null)
        })
    }
    load()
    const pollId = window.setInterval(load, 30000)
    return () => {
      cancelled = true
      window.clearInterval(pollId)
    }
  }, [useCargoSessionMode, operationId, formModalOpen, liveAtgTick, openLoadLineId, openLineDraft, useApi])

  const closedPersistedSum = useMemo(
    () => sumClosedPersistedLineQty(milestoneActivitiesFor(activities, 'CARGO OPERATIONS')),
    [activities]
  )

  const liveCargoProgress = useMemo(
    () =>
      buildLiveCargoProgressSnapshot({
        openLoadLineId,
        openLineDraft: formModalOpen ? openLineDraft : null,
        atgRef: openLineDraft ? atgRefByLineKey[openLineDraft.key] : null,
        sessionOperationalProgress,
        tankMetaById,
        activityRows: milestoneActivitiesFor(activities, 'CARGO OPERATIONS'),
      }),
    [
      openLoadLineId,
      formModalOpen,
      openLineDraft,
      atgRefByLineKey,
      sessionOperationalProgress,
      tankMetaById,
      activities,
    ]
  )

  const cargoProgressTotalLoaded = useMemo(() => {
    if (activeMilestone !== 'CARGO OPERATIONS') return null
    const siQty = Number.isFinite(Number(cargoSiQty)) ? Number(cargoSiQty) : null
    const loadedOther =
      cargoOpsFormDerived != null && siQty != null && Number.isFinite(cargoOpsFormDerived.basis)
        ? siQty - cargoOpsFormDerived.basis
        : 0
    return resolveCargoProgressTotalLoaded({
      loadedOther,
      cargoLoadLinesDraft,
      sessionOperationalProgress,
      openLineDraft,
      atgRef: openLineDraft ? atgRefByLineKey[openLineDraft.key] : null,
      tankMetaById,
      useCargoSessionMode,
      commodityType,
      closedPersistedSum,
    })
  }, [
    activeMilestone,
    cargoSiQty,
    cargoOpsFormDerived,
    cargoLoadLinesDraft,
    sessionOperationalProgress,
    openLineDraft,
    atgRefByLineKey,
    tankMetaById,
    useCargoSessionMode,
    commodityType,
    closedPersistedSum,
  ])

  const updateCargoLineDraft = useCallback((key, patch) => {
    setCargoLoadLinesDraft((prev) =>
      prev.map((row) => {
        if (row.key !== key) return row
        const next = { ...row, ...patch }
        if (Object.prototype.hasOwnProperty.call(patch, 'qty') && patch.qty !== row.qty) {
          next.qtyTouched = true
        }
        if (
          Object.prototype.hasOwnProperty.call(patch, 'start') ||
          Object.prototype.hasOwnProperty.call(patch, 'end') ||
          Object.prototype.hasOwnProperty.call(patch, 'tankIds') ||
          Object.prototype.hasOwnProperty.call(patch, 'manualQty') ||
          Object.prototype.hasOwnProperty.call(patch, 'atgQtyMode')
        ) {
          if (!Object.prototype.hasOwnProperty.call(patch, 'qtyTouched')) {
            next.qtyTouched = false
          }
        }
        const windowChanged =
          (Object.prototype.hasOwnProperty.call(patch, 'start') && patch.start !== row.start) ||
          (Object.prototype.hasOwnProperty.call(patch, 'end') && patch.end !== row.end) ||
          Object.prototype.hasOwnProperty.call(patch, 'tankIds')
        if (windowChanged && row.loadedManual) {
          // The segment no longer covers the window that was stored as manual, so
          // it goes back to ATG; the operator can mark it unavailable again if the
          // new window has no gauge data.
          next.loadedManual = false
          next.atgQtyMode = 'auto'
        }
        return next
      })
    )
  }, [])

  const cargoLineAtgSignature = useMemo(
    () =>
      `${liveAtgTick}|` +
      cargoLoadLinesDraft
        .map(
          (r) =>
            `${r.key}|${r.start}|${r.end}|${r.qtyTouched ? 1 : 0}|${r.atgQtyMode || 'auto'}|${(r.tankIds || []).join(',')}`
        )
        .join(';'),
    [cargoLoadLinesDraft, liveAtgTick]
  )

  useEffect(() => {
    if (commodityType !== 'Liquid' || portId == null || portId === '') {
      setAtgRefByLineKey({})
      return undefined
    }
    let cancelled = false
    const run = async () => {
      const nextRefs = {}
      const qtyAuto = new Map()
      for (const row of cargoLoadLinesDraft) {
        const { atgTankIds, manualTankIds } = partitionDraftTanks(row.tankIds, tankMetaById)
        if (!row.start || atgTankIds.length === 0 || row.atgQtyMode === 'manual') {
          nextRefs[row.key] = {
            status: 'idle',
            atgTankIds,
            manualTankIds,
          }
          continue
        }
        let startIso
        let endIso = null
        try {
          startIso = normalizeForApi(row.start, tz)
        } catch {
          nextRefs[row.key] = { status: 'error', atgTankIds, manualTankIds }
          continue
        }
        if (row.end) {
          try {
            endIso = normalizeForApi(row.end, tz)
          } catch {
            nextRefs[row.key] = { status: 'error', atgTankIds, manualTankIds }
            continue
          }
        }
        nextRefs[row.key] = { status: 'loading', atgTankIds, manualTankIds }
        try {
          const data = await fetchTankGaugingMassDelta({
            portId,
            tankIds: atgTankIds,
            startAt: startIso,
            endAt: endIso || undefined,
            purpose,
            siMetric: cargoSiMetricCode || 'MT',
          })
          const atgQty = readAtgQtyFromRef(data)
          nextRefs[row.key] = {
            status: 'ok',
            sumAtgQty: atgQty,
            sumDeltaMass: data.sumDeltaMass ?? atgQty,
            incomplete: data.incomplete,
            tanks: Array.isArray(data.tanks) ? data.tanks : [],
            error: data.error,
            atgTankIds,
            manualTankIds,
          }
          const atgOk = !data.incomplete && atgQty != null && atgQty > 0
          if (endIso && !row.qtyTouched && atgOk) {
            const atgPart = atgQty
            if (manualTankIds.length > 0) {
              const mq = parsePositiveQty(row.manualQty)
              const total = Number.isFinite(mq) ? atgPart + mq : atgPart
              qtyAuto.set(row.key, String(total))
            } else {
              qtyAuto.set(row.key, String(atgPart))
            }
          }
        } catch {
          nextRefs[row.key] = { status: 'error', atgTankIds, manualTankIds }
        }
      }
      if (cancelled) return
      if (qtyAuto.size > 0) {
        setCargoLoadLinesDraft((prev) =>
          prev.map((r) => {
            if (qtyAuto.has(r.key) && !r.qtyTouched) {
              return { ...r, qty: qtyAuto.get(r.key) }
            }
            return r
          })
        )
      }
      setAtgRefByLineKey(nextRefs)
    }
    run()
    return () => {
      cancelled = true
    }
  }, [cargoLineAtgSignature, portId, commodityType, tz, tankMetaById, purpose, cargoSiMetricCode])

  const addCargoLineDraft = useCallback(() => {
    setCargoLoadLinesDraft((prev) => {
      const last = prev[prev.length - 1]
      const nextStart = last?.end || ''
      const prevTanks = Array.isArray(last?.tankIds) ? last.tankIds.map(String) : []
      return [...prev, defaultCargoLineDraft(getNowForDateTimeLocal, nextStart, prevTanks)]
    })
  }, [getNowForDateTimeLocal])

  const removeCargoLineDraft = useCallback((key) => {
    setCargoLoadLinesDraft((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.key !== key)))
  }, [])

  const validateAndBuildPayload = (cat, sub, rem, st, en) => {
    const c = String(cat || '').trim()
    if (!c) return { error: 'Select a milestone.' }
    const remarkTrim = String(rem || '').trim()
    if (!remarkTrim) return { error: 'Remark is required.' }
    if (!st) return { error: 'Start time is required.' }
    let startIso
    try {
      startIso = normalizeForApi(st, tz)
    } catch {
      return { error: 'Invalid date or time.' }
    }
    if (!startIso) return { error: 'Invalid date or time.' }
    const ta = new Date(startIso).getTime()
    if (Number.isNaN(ta)) return { error: 'Invalid date or time.' }
    const mk = milestoneLabelToKey(c, purpose)
    if (!mk) return { error: 'Invalid milestone.' }
    const startOnly = mk === 'opening_hatch' || mk === 'cargo_pre_conditioning'
    let endOut = null
    if (startOnly) {
      if (en) {
        let endIso
        try {
          endIso = normalizeForApi(en, tz)
        } catch {
          return { error: 'Invalid end time.' }
        }
        const tb = new Date(endIso).getTime()
        if (Number.isNaN(tb)) return { error: 'Invalid end time.' }
        if (tb < ta) return { error: 'End time must be on or after start time.' }
        endOut = en
      }
    } else if (mk === 'cargo_operations') {
      if (en) {
        let endIso
        try {
          endIso = normalizeForApi(en, tz)
        } catch {
          return { error: 'Invalid end time.' }
        }
        const tb = new Date(endIso).getTime()
        if (Number.isNaN(tb)) return { error: 'Invalid end time.' }
        if (tb < ta) return { error: 'End time must be on or after start time.' }
        endOut = en
      }
      if (useApi) {
        if (!Array.isArray(cargoLoadLinesDraft) || cargoLoadLinesDraft.length === 0) {
          return { error: t('cargoOpsLinesMin') }
        }
        const built = []
        for (let i = 0; i < cargoLoadLinesDraft.length; i++) {
          const li = cargoLoadLinesDraft[i]
          if (!li.start) return { error: t('cargoOpsLineStartRequired', { n: i + 1 }) }
          let startIso
          let endIso = null
          try {
            startIso = normalizeForApi(li.start, tz)
          } catch {
            return { error: t('cargoOpsLineTimeInvalid', { n: i + 1 }) }
          }
          const tStart = new Date(startIso).getTime()
          if (Number.isNaN(tStart)) {
            return { error: t('cargoOpsLineTimeInvalid', { n: i + 1 }) }
          }
          if (tStart < ta) {
            return { error: t('cargoOpsLineStartBeforeActivity', { n: i + 1 }) }
          }
          const hasEnd = Boolean(li.end && String(li.end).trim())
          let tEnd = null
          if (hasEnd) {
            try {
              endIso = normalizeForApi(li.end, tz)
            } catch {
              return { error: t('cargoOpsLineTimeInvalid', { n: i + 1 }) }
            }
            tEnd = new Date(endIso).getTime()
            if (Number.isNaN(tEnd) || tEnd <= tStart) {
              return { error: t('cargoOpsLineEndAfterStart', { n: i + 1 }) }
            }
          }
          let mq = null
          if (li.qty != null && String(li.qty).trim() !== '') {
            mq = parsePositiveQty(li.qty)
            if (Number.isNaN(mq)) return { error: t('cargoOpsLineQtyInvalid', { n: i + 1 }) }
          }
          const atgQtyMode = li.atgQtyMode === 'manual' ? 'manual' : 'auto'
          let manualQty = null
          if (li.manualQty != null && String(li.manualQty).trim() !== '') {
            manualQty = parsePositiveQty(li.manualQty)
            if (Number.isNaN(manualQty)) {
              return { error: t('cargoOpsLineManualQtyInvalid', { n: i + 1 }) }
            }
          }
          const { atgTankIds, manualTankIds } = partitionDraftTanks(li.tankIds, tankMetaById)
          const isMixed = commodityType === 'Liquid' && atgTankIds.length > 0 && manualTankIds.length > 0
          const hasAtgTanks = commodityType === 'Liquid' && atgTankIds.length > 0
          const atgRef = atgRefByLineKey[li.key]
          const atgQty = readAtgQtyFromRef(atgRef)
          const atgOk = atgRef?.status === 'ok' && !atgRef.incomplete && atgQty != null && atgQty > 0
          if (isMixed && atgQtyMode === 'auto' && hasEnd && (manualQty == null || manualQty <= 0)) {
            return { error: t('cargoOpsLineManualQtyRequired', { n: i + 1 }) }
          }
          if (hasAtgTanks && atgQtyMode === 'auto' && hasEnd) {
            // Server recomputes from ATG; block the save when it has nothing to compute.
            if (!atgOk) {
              return { error: t('cargoOpsLineAtgRequired', { n: i + 1 }) }
            }
            mq = null
          } else if (hasEnd && mq == null) {
            return { error: t('cargoOpsLineQtyRequiredWhenEnd', { n: i + 1 }) }
          }
          if (commodityType === 'Liquid' && (!Array.isArray(li.tankIds) || li.tankIds.length === 0)) {
            return { error: t('cargoOpsLineTanksRequired', { n: i + 1 }) }
          }
          built.push({
            qty: mq,
            manualQty: isMixed ? manualQty : null,
            atgQtyMode,
            startIso,
            endIso,
            _sort: tStart,
            _end: tEnd,
            hasEnd,
            _i: i,
            tankIds: Array.isArray(li.tankIds) ? li.tankIds.map(String) : [],
          })
        }
        built.sort((a, b) => a._sort - b._sort || a._i - b._i)
        const openCount = built.filter((b) => !b.hasEnd).length
        if (openCount > 1) {
          return { error: t('cargoOpsLineOneOpenOnly') }
        }
        if (openCount === 1 && built[built.length - 1].hasEnd) {
          return { error: t('cargoOpsLineOpenMustBeLast') }
        }
        for (let j = 1; j < built.length; j++) {
          const prevEnd = built[j - 1]._end
          if (prevEnd == null) {
            return { error: t('cargoOpsLineAfterOpen') }
          }
          if (built[j]._sort < prevEnd) {
            return { error: t('cargoOpsLineOverlap') }
          }
          if (built[j]._sort <= built[j - 1]._sort) {
            return { error: t('cargoOpsLineStartStrict') }
          }
        }
        const cargoLoadLines = built.map(({ qty, manualQty, atgQtyMode, startIso, endIso, tankIds }) => {
          const row = { startAt: startIso, atgQtyMode: atgQtyMode || 'auto' }
          if (endIso) row.endAt = endIso
          else row.endAt = null
          if (qty != null) row.qty = qty
          if (manualQty != null) row.manualQty = manualQty
          if (commodityType === 'Liquid' && Array.isArray(tankIds) && tankIds.length > 0) {
            row.tankIds = tankIds
          }
          return row
        })
        return {
          payload: {
            milestoneKey: mk,
            subStepTitle: String(sub || '').trim(),
            description: remarkTrim,
            startTime: st,
            endTime: startOnly ? (en || null) : endOut,
            cargoLoadLines,
          },
        }
      }
    } else {
      if (!en) return { error: 'End time is required.' }
      let endIso
      try {
        endIso = normalizeForApi(en, tz)
      } catch {
        return { error: 'Invalid date or time.' }
      }
      const tb = new Date(endIso).getTime()
      if (Number.isNaN(tb)) return { error: 'Invalid date or time.' }
      if (tb < ta) return { error: 'End time must be after start time.' }
      endOut = en
    }
    return {
      payload: {
        milestoneKey: mk,
        subStepTitle: String(sub || '').trim(),
        description: remarkTrim,
        startTime: st,
        endTime: startOnly ? (en || null) : endOut,
      },
    }
  }

  const handleAdd = async (andAnother = false) => {
    const { error, payload } = validateAndBuildPayload(
      activeMilestone,
      subStepTitle,
      remark,
      startTime,
      endTime
    )
    if (error) {
      setFormError(error)
      return
    }
    if (useApi && payload.milestoneKey === 'cargo_operations') {
      const siQty = cargoSiQty
      if (siQty != null && Number.isFinite(Number(siQty))) {
        const rows = milestoneActivitiesFor(activities, 'CARGO OPERATIONS')
        const lines = collectCargoLoadLines(rows, {
          excludeEntryId: editingEntryId,
          draftLines: cargoLoadLinesDraft,
        })
        const mismatch = detectCargoSiQtyMismatch({ siQty: Number(siQty), lines })
        if (mismatch) {
          const msg = formatCargoSiQtyMismatchConfirm(mismatch, t)
          if (!window.confirm(msg)) return
        }
      }
    }
    if (useApi) {
      try {
        const startAtIso = normalizeForApi(payload.startTime, tz)
        const endIso =
          payload.endTime != null && payload.endTime !== ''
            ? normalizeForApi(payload.endTime, tz)
            : null
        const activityBody = {
          milestoneKey: payload.milestoneKey,
          subStepTitle: payload.subStepTitle,
          remark: payload.description,
          startAt: startAtIso,
          endAt: endIso,
        }
        if (payload.milestoneKey === 'cargo_operations' && Array.isArray(payload.cargoLoadLines)) {
          activityBody.cargoLoadLines = payload.cargoLoadLines
        }
        let savedEntryId = editingEntryId
        if (editingEntryId) {
          await updateOperationalEntry(operationId, editingEntryId, activityBody, { scheduleIana: tz })
        } else {
          const created = await createOperationalEntry(
            operationId,
            {
              entryType: 'activity',
              ...activityBody,
            },
            { scheduleIana: tz }
          )
          if (created?.id != null) savedEntryId = String(created.id)
        }
        await loadApi()
        bumpSaved()
        setActionToast({
          message: editingEntryId
            ? 'Activity updated.'
            : andAnother
              ? t('cargoOpsSavedAddEntry')
              : 'Activity saved.',
          variant: 'success',
        })
        if (andAnother && activeMilestone === 'CARGO OPERATIONS') {
          if (savedEntryId) setEditingEntryId(String(savedEntryId))
          setCargoLoadLinesDraft((prev) => {
            const last = prev[prev.length - 1]
            const nextStart = last?.end || getNowForDateTimeLocal()
            const prevTanks = Array.isArray(last?.tankIds) ? last.tankIds.map(String) : []
            return [...prev, defaultCargoLineDraft(getNowForDateTimeLocal, nextStart, prevTanks)]
          })
          setFormError('')
          return
        }
      } catch (e) {
        setFormError(e?.message || 'Failed to save activity')
        return
      }
    } else {
      const localLines =
        activeMilestone === 'CARGO OPERATIONS' && Array.isArray(cargoLoadLinesDraft)
          ? cargoLoadLinesDraft
              .map((li) => {
                const mq = parsePositiveQty(li.qty)
                if (Number.isNaN(mq) || !li.start || !li.end) return null
                try {
                  const startIso = normalizeForApi(li.start, tz)
                  const endIso = normalizeForApi(li.end, tz)
                  return { qty: mq, startAt: startIso, endAt: endIso }
                } catch {
                  return null
                }
              })
              .filter(Boolean)
          : undefined
      addActivity(vesselId, {
        category: activeMilestone,
        subStepTitle: payload.subStepTitle,
        description: payload.description,
        startTime: payload.startTime,
        endTime: payload.endTime || null,
        ...(localLines && localLines.length ? { cargoLoadLines: localLines } : {}),
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
  const startOnlyForm = activeMilestone === 'OPENING' || activeMilestone === 'CARGO PRE-CONDITIONING'
  const endTimeRequired = activeMilestone === 'OTHER'
  const canMarkNa = activeMilestone && !naMap[activeMilestone]?.reason && activeRows.length === 0
  const isCargoOpsModal = activeMilestone === 'CARGO OPERATIONS'

  const subStepField = (
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
        maxLength={MAX_MILESTONE_SUBSTEP_TITLE_CHARS}
        placeholder={activeMilestone === 'OPENING' ? 'e.g. H1, H2, H3' : 'e.g. Second hose connection, leak check'}
      />
    </div>
  )

  const activityTimesBlock = (
    <>
      <div className={`cargo-ops-time-range${startOnlyForm ? ' cargo-ops-time-range--start-only' : ''}`}>
        <div className="cargo-ops-time-range__field">
          <input
            type="datetime-local"
            className="berthing-modal__input"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
          <span className="cargo-ops-time-range__caption">
            Start time <span className="required-star">*</span>
          </span>
        </div>
        {!startOnlyForm ? (
          <>
            <span className="cargo-ops-time-range__arrow" aria-hidden="true">→</span>
            <div className="cargo-ops-time-range__field">
              <input
                type="datetime-local"
                className="berthing-modal__input"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
              <span className="cargo-ops-time-range__caption">
                End time {endTimeRequired ? <span className="required-star">*</span> : null}
              </span>
            </div>
          </>
        ) : null}
      </div>
      {!startOnlyForm && startTime && endTime ? (
        <p className="operational-duration-hint">
          Duration: <strong>{formatDurationLabel(startTime, endTime)}</strong>
        </p>
      ) : null}
    </>
  )

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
              cargoSiQty={cargoSiQty ?? null}
              cargoSiMetricLabel={cargoSiMetricCode ?? cargoSiMetricName ?? null}
              liveCargoProgress={liveCargoProgress}
            />
            {formModalOpen ? (
              <div className="modal-overlay" onClick={() => { setFormModalOpen(false); setEditingEntryId(null) }} aria-hidden="true">
                <div className="modal modal--wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Operational form">
                  <section className="berthing-modal__card loading-tab-card operational-milestone-composer">
            {isCargoOpsModal ? (
              <div className="operational-milestone-composer__title-row">
                <div className="operational-milestone-composer__title-group">
                  <h3 className="berthing-modal__card-title operational-milestone-composer__title" id="op-milestone-active-label">
                    {activeMilestone}
                  </h3>
                  {(cargoCommodity != null && String(cargoCommodity).trim()) || (cargoSiQty != null && cargoSiQty !== '' && Number.isFinite(Number(cargoSiQty))) ? (
                    <p className="cargo-ops-modal-meta text-steel">
                      {cargoCommodity != null && String(cargoCommodity).trim() ? String(cargoCommodity).trim() : null}
                      {cargoCommodity != null && String(cargoCommodity).trim() && cargoSiQty != null && cargoSiQty !== '' && Number.isFinite(Number(cargoSiQty)) ? <span className="cargo-ops-modal-meta__sep"> · </span> : null}
                      {cargoSiQty != null && cargoSiQty !== '' && Number.isFinite(Number(cargoSiQty))
                        ? `${Number(cargoSiQty).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${cargoOpsFormDerived?.metricLabel ?? ''}`
                        : null}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="field-help-btn"
                  title={t('cargoOpsSubtitle')}
                  aria-label={t('cargoOpsSubtitle')}
                >
                  <span className="field-help-btn__glyph" aria-hidden>
                    i
                  </span>
                </button>
              </div>
            ) : (
              <h3 className="berthing-modal__card-title operational-milestone-composer__title" id="op-milestone-active-label">
                {activeMilestone}
              </h3>
            )}
            {activeMilestone === 'OPENING' ? (
              <p className="operational-milestone-composer__subtitle text-steel">
                Add one row per hatch (e.g. H1, H2). Start time records when each hatch opening began; end time is not used for this milestone.
              </p>
            ) : null}
            {activeMilestone === 'CARGO PRE-CONDITIONING' ? (
              <p className="operational-milestone-composer__subtitle text-steel">
                Capture pre-operation readiness: preparation, condition checks, and pre-transfer notes in the remark field. Only start time is required.
              </p>
            ) : null}
            {activeDisplay.statusClass === 'na' ? (
              <p className="operational-milestone-composer__subtitle operational-milestone-active__na">
                This milestone is marked N/A — add an activity only if you are correcting that.
              </p>
            ) : null}

            {isCargoOpsModal ? (
              <div className="cargo-ops-section">
                <p className="cargo-ops-section__label">Operation Window</p>
                {activityTimesBlock}
              </div>
            ) : null}

            {!isCargoOpsModal ? subStepField : null}
            {activeMilestone === 'OPENING' ? (
              <div className="berthing-modal__field">
                <label className="berthing-modal__label" htmlFor="op-opening-cargo-handling-method">
                  Cargo handling method
                </label>
                <select
                  id="op-opening-cargo-handling-method"
                  className="berthing-modal__input"
                  disabled
                  value={openingHandlingLabel}
                  aria-readonly="true"
                  title="Derived from shipping instruction commodity type (Solid → Conveyor, Liquid → Hose)"
                >
                  <option value={openingHandlingLabel}>{openingHandlingLabel}</option>
                </select>
              </div>
            ) : null}

            {activeMilestone === 'CARGO OPERATIONS' ? (
              <>
                {(() => {
                  const siQty = Number.isFinite(Number(cargoSiQty)) ? Number(cargoSiQty) : null
                  const totalLoaded =
                    cargoProgressTotalLoaded != null && Number.isFinite(Number(cargoProgressTotalLoaded))
                      ? Number(cargoProgressTotalLoaded)
                      : 0
                  const pct = siQty != null && siQty > 0 ? Math.min(100, (totalLoaded / siQty) * 100) : null
                  const metricLabel = cargoOpsFormDerived?.metricLabel ?? ''
                  const balance = siQty != null ? siQty - totalLoaded : null
                  return (
                    <div className="cargo-ops-section cargo-ops-section--progress">
                      <p className="cargo-ops-section__label">{purpose === 'Unloading' ? 'Unloading Progress' : 'Loading Progress'}</p>
                      <div className="cargo-ops-progress">
                        <div className="cargo-ops-progress__labels">
                          <span className="cargo-ops-progress__loaded">
                            {totalLoaded > 0
                              ? `${totalLoaded.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${metricLabel} ${purpose === 'Unloading' ? 'unloaded' : 'loaded'}`
                              : 'Not started'}
                          </span>
                          {siQty != null ? (
                            <span className="cargo-ops-progress__balance text-steel">
                              {balance != null && balance > 1e-6
                                ? `${balance.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${metricLabel} remaining`
                                : balance != null && balance < -1e-6
                                  ? t('cargoOpsQtyOverSiProgress', {
                                      delta: `${Math.abs(balance).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${metricLabel}`,
                                    })
                                  : balance != null
                                    ? 'Complete'
                                    : null}
                            </span>
                          ) : null}
                        </div>
                        <div className="cargo-ops-progress__bar-track" role="progressbar" aria-valuenow={pct ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={purpose === 'Unloading' ? 'Unloading progress' : 'Loading progress'}>
                          <div
                            className="cargo-ops-progress__bar-fill"
                            style={{ width: pct != null ? `${pct.toFixed(2)}%` : '0%' }}
                          />
                        </div>
                        {siQty != null ? (
                          <div className="cargo-ops-progress__totals text-steel">
                            {pct != null ? `${pct.toFixed(1)}%` : '—'} of {siQty.toLocaleString(undefined, { maximumFractionDigits: 6 })} {metricLabel}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )
                })()}

                <div className="cargo-ops-section">
                  <div className="cargo-ops-section__header">
                    <p className="cargo-ops-section__label cargo-ops-section__label--inline">{t('cargoOpsLoadSegments')}</p>
                    <button
                      type="button"
                      className="btn btn--small btn--secondary"
                      onClick={() => addCargoLineDraft()}
                      disabled={cargoOpsFormDerived?.canAddLine === false}
                    >
                      + {t('cargoOpsAddLine')}
                    </button>
                  </div>

                  {(cargoOpsFormDerived?.lineRows || []).length === 0 && useCargoSessionMode ? (
                    <p className="text-steel cargo-ops-session__hint">{t('cargoOpsSegmentsEmptyHint')}</p>
                  ) : null}

                  {(cargoOpsFormDerived?.lineRows || []).map((lr, idx) => {
                    const row = cargoLoadLinesDraft.find((d) => d.key === lr.key)
                    if (!row) return null
                    const lineRows = cargoOpsFormDerived?.lineRows || []
                    const isLastLine = lineRows.length > 0 && lineRows[lineRows.length - 1].key === lr.key
                    const atgRef = atgRefByLineKey[lr.key]
                    const { atgTankIds, manualTankIds } = partitionDraftTanks(row.tankIds, tankMetaById)
                    const isAllAtg =
                      commodityType === 'Liquid' && atgTankIds.length > 0 && manualTankIds.length === 0
                    const isMixed =
                      commodityType === 'Liquid' && atgTankIds.length > 0 && manualTankIds.length > 0
                    const atgQtyMode = row.atgQtyMode === 'manual' ? 'manual' : 'auto'
                    const atgQty = readAtgQtyFromRef(atgRef)
                    const atgOk =
                      atgRef?.status === 'ok' &&
                      !atgRef.incomplete &&
                      atgQty != null &&
                      atgQty > 0
                    const hasAtgTanks = commodityType === 'Liquid' && atgTankIds.length > 0
                    const atgUnavailable =
                      hasAtgTanks &&
                      atgQtyMode === 'auto' &&
                      Boolean(row.end && row.start) &&
                      (atgRef?.status === 'error' ||
                        atgRef?.status === 'ok' && (atgRef.incomplete || !atgOk))
                    // Quantity is ATG-owned whenever the line is in auto mode; the only
                    // way to type a number is to mark ATG not available.
                    const qtyDisabled = hasAtgTanks && atgQtyMode === 'auto'
                    // Manual override is only offered when ATG cannot answer for this
                    // window. Rows already stored as manual stay editable so they can be
                    // reviewed and switched back to ATG.
                    const manualToggleLocked = atgOk && !row.loadedManual
                    const atgNowAvailable = atgOk && atgQtyMode === 'manual'
                    const atgFmt = atgOk
                      ? atgQty.toLocaleString(undefined, { maximumFractionDigits: 6 })
                      : null
                    const atgTankHint =
                      atgRef?.status === 'ok' && Array.isArray(atgRef.tanks) && atgRef.tanks.length > 1
                        ? atgRef.tanks
                            .filter((tk) => tk.deltaMass != null || tk.deltaKl != null)
                            .map((tk) => {
                              const delta = tk.deltaKl != null ? tk.deltaKl : tk.deltaMass
                              return `${tk.code || tk.tankId} ${Number(delta) >= 0 ? '+' : ''}${Number(delta).toLocaleString(undefined, { maximumFractionDigits: 3 })}`
                            })
                            .join(' · ')
                        : ''
                    const qtyAutoFilled =
                      commodityType === 'Liquid' &&
                      Boolean(row.end && row.start) &&
                      !row.qtyTouched &&
                      atgOk &&
                      atgFmt &&
                      atgQtyMode === 'auto'
                    return (
                      <div key={lr.key} className="cargo-line-card">
                        <div className="cargo-line-card__header">
                          <span className="cargo-line-card__entry-chip">{t('cargoOpsEntryLabel', { n: idx + 1 })}</span>
                          {!row.end && row.start ? (
                            <span className="cargo-line-card__in-progress">{t('cargoOpsLineInProgress')}</span>
                          ) : null}
                          {cargoLoadLinesDraft.length > 1 ? (
                            <button
                              type="button"
                              className="cargo-line-card__remove"
                              onClick={() => removeCargoLineDraft(lr.key)}
                              aria-label={t('cargoOpsRemoveLine', { n: idx + 1 })}
                              title={t('cargoOpsRemoveLine', { n: idx + 1 })}
                            >
                              ×
                            </button>
                          ) : null}
                        </div>

                        <div className="cargo-line-card__body">
                          {commodityType === 'Liquid' ? (
                            <div className="berthing-modal__field cargo-line-card__tanks-field">
                              <label className="berthing-modal__label" htmlFor={`op-cargo-tanks-${lr.key}`}>
                                {purpose === 'Unloading' ? t('cargoOpsSourceTanks') : t('cargoOpsDestinationTanks')}{' '}
                                <span className="required-star">*</span>
                              </label>
                              <DropdownMultiSelect
                                id={`op-cargo-tanks-${lr.key}`}
                                options={masterTankOptions}
                                selectedValues={Array.isArray(row.tankIds) ? row.tankIds : []}
                                onChange={(ids) => updateCargoLineDraft(lr.key, { tankIds: ids })}
                                placeholder={t('cargoOpsTanksPlaceholder')}
                                emptyText={t('cargoOpsTanksEmpty')}
                                searchable
                                searchPlaceholder="Search..."
                                className="cargo-ops-tanks-dropdown"
                              />
                            </div>
                          ) : null}

                          <div className="cargo-ops-time-range cargo-ops-time-range--segment">
                            <div className="cargo-ops-time-range__field">
                              <input
                                id={`op-cargo-start-${lr.key}`}
                                type="datetime-local"
                                className="berthing-modal__input"
                                value={row.start}
                                onChange={(e) => updateCargoLineDraft(lr.key, { start: e.target.value })}
                              />
                              <span className="cargo-ops-time-range__caption">
                                {t('cargoOpsLineStart')} <span className="required-star">*</span>
                              </span>
                            </div>
                            <span className="cargo-ops-time-range__arrow" aria-hidden="true">→</span>
                            <div className="cargo-ops-time-range__field">
                              <input
                                id={`op-cargo-end-${lr.key}`}
                                type="datetime-local"
                                className="berthing-modal__input"
                                value={row.end}
                                onChange={(e) => updateCargoLineDraft(lr.key, { end: e.target.value })}
                              />
                              <span className="cargo-ops-time-range__caption">
                                {isLastLine ? t('cargoOpsLineEndOptional') : t('cargoOpsLineEnd')}{' '}
                                {!isLastLine ? <span className="required-star">*</span> : null}
                              </span>
                            </div>
                          </div>

                          <div className="cargo-line-card__qty-row">
                            <div className="berthing-modal__field cargo-line-card__qty-field">
                              <label className="berthing-modal__label" htmlFor={`op-cargo-qty-${lr.key}`}>
                                {commodityType === 'Solid' ? t('cargoOpsQtyWb') : purpose === 'Unloading' ? t('cargoOpsQtyUnload') : t('cargoOpsQtyLoad')}{' '}
                                {row.end && !isMixed ? <span className="required-star">*</span> : null}
                              </label>
                              <div className="cargo-line-card__qty-input-wrap">
                                <input
                                  id={`op-cargo-qty-${lr.key}`}
                                  type="text"
                                  inputMode="decimal"
                                  className="berthing-modal__input"
                                  value={row.qty}
                                  onChange={(e) => updateCargoLineDraft(lr.key, { qty: e.target.value })}
                                  placeholder={t('cargoOpsQtyPlaceholder')}
                                  autoComplete="off"
                                  disabled={qtyDisabled}
                                  readOnly={qtyDisabled}
                                />
                                {cargoOpsFormDerived?.metricLabel ? (
                                  <span className="cargo-line-card__unit">{cargoOpsFormDerived.metricLabel}</span>
                                ) : null}
                              </div>
                              {qtyAutoFilled ? (
                                <p className="cargo-line-card__qty-hint text-steel">{t('cargoOpsQtyAutoFilled')}</p>
                              ) : null}
                              {atgUnavailable && isAllAtg ? (
                                <p className="cargo-line-card__qty-hint text-steel" style={{ color: 'var(--color-danger, #c00)' }}>
                                  {t('cargoOpsAtgUnavailableHint')}
                                </p>
                              ) : null}
                              {atgNowAvailable && atgFmt ? (
                                <p className="cargo-line-card__qty-hint text-steel">
                                  {t('cargoOpsAtgNowAvailableHint', { qty: atgFmt })}
                                </p>
                              ) : null}
                            </div>
                            {isMixed ? (
                              <div className="berthing-modal__field cargo-line-card__qty-field">
                                <label className="berthing-modal__label" htmlFor={`op-cargo-manual-qty-${lr.key}`}>
                                  {t('cargoOpsManualQty')}{' '}
                                  {row.end ? <span className="required-star">*</span> : null}
                                </label>
                                <div className="cargo-line-card__qty-input-wrap">
                                  <input
                                    id={`op-cargo-manual-qty-${lr.key}`}
                                    type="text"
                                    inputMode="decimal"
                                    className="berthing-modal__input"
                                    value={row.manualQty || ''}
                                    onChange={(e) =>
                                      updateCargoLineDraft(lr.key, {
                                        manualQty: e.target.value,
                                        qtyTouched: false,
                                      })
                                    }
                                    placeholder={t('cargoOpsQtyPlaceholder')}
                                    autoComplete="off"
                                  />
                                  {cargoOpsFormDerived?.metricLabel ? (
                                    <span className="cargo-line-card__unit">{cargoOpsFormDerived.metricLabel}</span>
                                  ) : null}
                                </div>
                                <p className="cargo-line-card__qty-hint text-steel">{t('cargoOpsManualQtyHint')}</p>
                              </div>
                            ) : null}
                            {commodityType === 'Liquid' && atgTankIds.length > 0 ? (
                              <div className="cargo-line-card__atg-ref" title={atgTankHint || undefined}>
                                <span className="cargo-line-card__atg-label">{t('cargoOpsAtgRefLabel')}</span>
                                <span className="cargo-line-card__atg-value">
                                  {atgQtyMode === 'manual'
                                    ? t('cargoOpsAtgModeManual')
                                    : atgRef?.status === 'loading'
                                      ? '…'
                                      : atgFmt
                                        ? `${atgFmt}${cargoOpsFormDerived?.metricLabel ? ` ${cargoOpsFormDerived.metricLabel.split(' · ')[0]}` : ''}`
                                        : t('cargoOpsAtgRefUnavailable')}
                                </span>
                                {atgRef?.incomplete && atgQtyMode === 'auto' ? (
                                  <span className="cargo-line-card__atg-partial text-steel">
                                    {' '}
                                    ·{' '}
                                    {readAtgQtyFromRef(atgRef) == null
                                      ? t('cargoOpsAtgNoSamples')
                                      : t('cargoOpsAtgRatePartial')}
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
                          </div>

                          {hasAtgTanks ? (
                            <label
                              className="cargo-line-card__atg-mode"
                              htmlFor={`op-cargo-atg-manual-${lr.key}`}
                              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.35rem' }}
                              title={manualToggleLocked ? t('cargoOpsAtgLockedHint') : undefined}
                            >
                              <input
                                id={`op-cargo-atg-manual-${lr.key}`}
                                type="checkbox"
                                checked={atgQtyMode === 'manual'}
                                disabled={manualToggleLocked}
                                onChange={(e) =>
                                  updateCargoLineDraft(lr.key, {
                                    atgQtyMode: e.target.checked ? 'manual' : 'auto',
                                    qtyTouched: e.target.checked,
                                  })
                                }
                              />
                              <span className="text-steel">{t('cargoOpsAtgNotAvailable')}</span>
                              {manualToggleLocked ? (
                                <span className="text-steel">· {t('cargoOpsAtgLockedHint')}</span>
                              ) : null}
                            </label>
                          ) : null}

                          <div className="cargo-line-card__derived">
                            <span>
                              {t('cargoOpsRate')}:{' '}
                              <strong>
                                {lr.ratePerHour != null && Number.isFinite(lr.ratePerHour)
                                  ? `${lr.ratePerHour.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${cargoOpsFormDerived?.metricLabel ?? ''}/h`
                                  : '—'}
                              </strong>
                            </span>
                            <span className="cargo-line-card__derived-sep">·</span>
                            <span>
                              {t('cargoOpsBalance')}:{' '}
                              <strong>
                                {lr.balanceAfter != null && Number.isFinite(lr.balanceAfter)
                                  ? `${lr.balanceAfter.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${cargoOpsFormDerived?.metricLabel ?? ''}`
                                  : '—'}
                              </strong>
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {useCargoSessionMode ? (
                  <CargoLiveMovementPanel
                    openLine={openLineDraft}
                    atgRef={openLineDraft ? atgRefByLineKey[openLineDraft.key] : null}
                    hourlyProgress={sessionOperationalProgress}
                    tankMetaById={tankMetaById}
                    metricLabel={cargoOpsFormDerived?.metricLabel ?? ''}
                    purpose={purpose}
                    scheduleTimezone={tz}
                    operationId={operationId}
                    openLoadLineId={openLoadLineId}
                  />
                ) : null}
              </>
            ) : null}

            <div className="cargo-ops-notes-section">
              {!isCargoOpsModal ? activityTimesBlock : null}

              <div className="berthing-modal__field">
                <label className="berthing-modal__label" htmlFor="op-remark">
                  Remark <span className="required-star">*</span>
                </label>
                <textarea
                  id="op-remark"
                  className="berthing-modal__input berthing-modal__textarea"
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  maxLength={MAX_ACTIVITY_REMARK_CHARS}
                  placeholder="What happened, evidence, or handover note"
                  rows={8}
                />
              </div>

              {cargoQtyMismatch ? (
                <p className="operational-form-warning cargo-ops-qty-warning" role="status">
                  {formatCargoSiQtyMismatchBanner(
                    cargoQtyMismatch,
                    t,
                    cargoOpsFormDerived?.metricLabel ?? ''
                  )}
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
                  {isCargoOpsModal ? t('cargoOpsSaveAddEntry') : 'Save & add another'}
                </button>
              </div>
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
                maxLength={MAX_MILESTONE_REASON_CHARS}
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
