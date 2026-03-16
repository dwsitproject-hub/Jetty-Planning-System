import { useState, Fragment, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { allocationPlan as initialPlan, BERTH_IDS, berths, vessels, ALLOCATION_EVENTS, BERTHING_EVENTS, setArrivalNor } from '../data/mockData'
import JettySchematic from '../components/JettySchematic'
import { useLoading, getLoadingPhaseIndex } from '../context/LoadingContext'
import '../styles/allocation.css'

const SLOTS_COUNT = 12
const SLOT_MS = 6 * 60 * 60 * 1000

/** Unified flow for both Loading and Unloading */
const UNIFIED_PHASES = ['Shipping Instruction', 'Allocation', 'Berthing', 'Pre Checking', 'Operational', 'Post Checking', 'Clearance']

const PHASE_ROUTES = {
  'Shipping Instruction': '/shipping-instruction',
  'Allocation': '/allocation',
  'Berthing': '/allocation',
  'Pre Checking': '/loading',
  'Operational': '/loading',
  'Post Checking': '/loading',
  'Clearance': '/verification',
}

function getPhaseLink(label, vesselId, purpose) {
  const base = PHASE_ROUTES[label] || '#'
  if (!vesselId) return base
  if (label === 'Pre Checking' || label === 'Operational' || label === 'Post Checking') {
    const unloadBase = '/unloading'
    return purpose === 'Unloading' ? `${unloadBase}${vesselId ? `/${vesselId}` : ''}` : `${base}/${vesselId}`
  }
  if (label === 'Clearance') return base
  return base
}

function get72hWindowStart(plan) {
  let minTs = Infinity
  plan.forEach((r) => {
    const t = r.etbDateTime || r.etaDateTime
    if (t) {
      const d = new Date(t)
      d.setHours(0, 0, 0, 0)
      const ts = d.getTime()
      if (ts < minTs) minTs = ts
    }
  })
  if (minTs === Infinity) minTs = Date.now()
  return new Date(minTs)
}

function getScheduleSlotLabels(windowStart) {
  return Array.from({ length: SLOTS_COUNT }, (_, i) => {
    const d = new Date(windowStart.getTime() + i * SLOT_MS)
    const day = d.getDate()
    const month = d.toLocaleString('en-GB', { month: 'short' }).toUpperCase()
    const hours = d.getHours()
    return `${day} ${month} - ${String(hours).padStart(2, '0')}:00`
  })
}

function buildOccupancyFromPlan(plan, windowStart) {
  const startTs = windowStart.getTime()
  const occupancies = []
  const sorted = [...plan].sort((a, b) => (a.sequence ?? 99) - (b.sequence ?? 99))
  sorted.forEach((r) => {
    const jettyId = (r.jetty || '').trim().split('/')[0].trim()
    if (!jettyId) return
    const timeStr = r.etbDateTime || r.etaDateTime
    if (!timeStr) return
    const slotStart = Math.floor((new Date(timeStr).getTime() - startTs) / SLOT_MS)
    if (slotStart < 0 || slotStart >= SLOTS_COUNT) return
    const slotEnd = Math.min(slotStart + 3, SLOTS_COUNT)
    let status = 'Expected'
    if (r.sequence === 1) status = 'Active'
    else if (r.sequence === 2) status = 'Berthing'
    occupancies.push({
      jettyId,
      vesselId: r.vesselId,
      vesselName: r.vesselName || r.vesselId,
      slotStart,
      slotEnd,
      status,
    })
  })
  return occupancies
}

function getOccupancyInSlot(occupancies, jettyId, slotIndex) {
  const occ = occupancies.find(
    (o) => o.jettyId === jettyId && o.slotStart <= slotIndex && slotIndex < o.slotEnd
  )
  if (occ && occ.slotStart === slotIndex) return { ...occ, span: occ.slotEnd - occ.slotStart }
  if (occ) return 'continued'
  return null
}

function getVesselName(vesselId) {
  return vessels[vesselId]?.vesselName ?? vesselId
}

const PRIORITY_OPTIONS = ['Low', 'Moderate', 'High', 'Critical']

const ALLOCATION_COLUMNS = [
  { key: 'sequence', label: 'Berthing sequence', getValue: (r) => r.sequence ?? '—', getSortValue: (r) => r.sequence ?? 0 },
  { key: 'vesselName', label: 'Vessel Name', getValue: (r) => <strong>{r.vesselName || '—'}</strong>, getSortValue: (r) => (r.vesselName || '').toLowerCase() },
  { key: 'shippingInstruction', label: 'Shipping Instruction', getValue: (r) => r.shippingInstruction || '—', getSortValue: (r) => (r.shippingInstruction || '').toLowerCase() },
  { key: 'priority', label: 'Priority', getValue: (r) => r.priority || '—', getSortValue: (r) => (r.priority || '').toLowerCase() },
  { key: 'purpose', label: 'Purpose', getValue: (r) => r.purpose || '—', getSortValue: (r) => (r.purpose || '').toLowerCase() },
  { key: 'remark', label: 'Remark', getValue: (r) => r.remark || r.remarks || '—', getSortValue: (r) => (r.remark || r.remarks || '').toLowerCase() },
  { key: 'eta', label: 'ETA', getValue: (r) => r.eta || '—', getSortValue: (r) => (r.eta || '').toLowerCase() },
  { key: 'etb', label: 'ETB', getValue: (r) => r.etb || '—', getSortValue: (r) => (r.etb || '').toLowerCase() },
  { key: 'jetty', label: 'Jetty', getValue: (r) => r.jetty || '—', getSortValue: (r) => (r.jetty || '').toLowerCase() },
]

/** Format datetime-local value to display string (dd/mm hh:mm LT) */
function formatDateTimeDisplay(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const hours = String(d.getHours()).padStart(2, '0')
  const mins = String(d.getMinutes()).padStart(2, '0')
  return `${day}/${month} ${hours}:${mins} LT`
}

/** Return current local date-time as YYYY-MM-DDTHH:mm for datetime-local input */
function getNowForDateTimeLocal() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day}T${h}:${min}`
}

export default function Allocation() {
  const [list, setList] = useState(initialPlan)
  const [berthsState, setBerthsState] = useState(() => [...berths].map((b) => ({ ...b })))
  const filterKeys = ALLOCATION_COLUMNS.map((c) => c.key)
  const [filters, setFilters] = useState(Object.fromEntries(filterKeys.map((k) => [k, ''])))
  const [sortState, setSortState] = useState({ key: 'sequence', dir: 'asc' })
  const [expandedId, setExpandedId] = useState(null)
  const [vesselDetailModalVesselId, setVesselDetailModalVesselId] = useState(null)
  const [arrivalUpdateForm, setArrivalUpdateForm] = useState(null)
  const [berthingConfirmRow, setBerthingConfirmRow] = useState(null)
  const [berthingErrors, setBerthingErrors] = useState([])
  const [berthingSelectedJetty, setBerthingSelectedJetty] = useState('')
  const [berthingPob, setBerthingPob] = useState('')
  const [berthingTb, setBerthingTb] = useState('')
  const [berthingSob, setBerthingSob] = useState('')
  const [berthingPhotos, setBerthingPhotos] = useState([]) // { id, file, previewUrl }[]
  const [berthingRemarks, setBerthingRemarks] = useState('')
  const [vesselPhotosByVesselId, setVesselPhotosByVesselId] = useState({}) // { [vesselId]: [{ url, name }] }
  const [berthingSuccessMessage, setBerthingSuccessMessage] = useState(null)
  const [visualTab, setVisualTab] = useState('schematic') // 'schematic' | 'schedule'
  const { getSteps: getLoadingSteps } = useLoading()

  const scheduleData = useMemo(() => {
    const plan = [...list].sort((a, b) => (a.sequence ?? 99) - (b.sequence ?? 99))
    const windowStart = get72hWindowStart(plan)
    return {
      windowStart,
      slotLabels: getScheduleSlotLabels(windowStart),
      occupancies: buildOccupancyFromPlan(plan, windowStart),
    }
  }, [list])

  const [arrivalNorFiles, setArrivalNorFiles] = useState([]) // [{ name, url }] for NOR document preview

  const openArrivalUpdate = (r) => {
    setArrivalUpdateForm({
      ...r,
      etaDateTime: r.etaDateTime || '',
      taDateTime: r.taDateTime || '',
      etbDateTime: r.etbDateTime || '',
      norTenderedDateTime: r.norTenderedDateTime || '',
      norAcceptedDateTime: r.norAcceptedDateTime || '',
    })
    setArrivalNorFiles([])
  }

  const addArrivalNorFiles = (files) => {
    if (!files?.length) return
    const newOnes = Array.from(files).map((file) => ({
      name: file.name,
      url: URL.createObjectURL(file),
    }))
    setArrivalNorFiles((prev) => [...prev, ...newOnes])
  }

  const saveArrivalUpdate = () => {
    if (!arrivalUpdateForm) return
    const newSequence = Math.max(1, Math.min(list.length, Number(arrivalUpdateForm.sequence) || 1))
    const updated = {
      ...arrivalUpdateForm,
      sequence: newSequence,
      eta: arrivalUpdateForm.etaDateTime ? formatDateTimeDisplay(arrivalUpdateForm.etaDateTime) : arrivalUpdateForm.eta,
      ta: arrivalUpdateForm.taDateTime ? formatDateTimeDisplay(arrivalUpdateForm.taDateTime) : arrivalUpdateForm.ta,
      etb: arrivalUpdateForm.etbDateTime ? formatDateTimeDisplay(arrivalUpdateForm.etbDateTime) : arrivalUpdateForm.etb,
      norTenderedDateTime: arrivalUpdateForm.norTenderedDateTime || undefined,
      norAcceptedDateTime: arrivalUpdateForm.norAcceptedDateTime || undefined,
      norDocumentNames: arrivalNorFiles.length > 0 ? arrivalNorFiles.map((f) => f.name) : undefined,
    }
    const listWithUpdate = list.map((row) => (row.id === arrivalUpdateForm.id ? updated : row))
    const bySequence = [...listWithUpdate].sort((a, b) => (a.sequence ?? 999) - (b.sequence ?? 999))
    const renumbered = bySequence.map((row, i) => ({ ...row, sequence: i + 1 }))
    setList(renumbered)
    if (updated.vesselId) {
      setArrivalNor(updated.vesselId, {
        norDocumentNames: Array.isArray(updated.norDocumentNames) ? updated.norDocumentNames : (arrivalNorFiles.map((f) => f.name) || []),
        norTenderedDateTime: updated.norTenderedDateTime || '',
        norAcceptedDateTime: updated.norAcceptedDateTime || '',
      })
    }
    setArrivalUpdateForm(null)
    setArrivalNorFiles([])
  }

  const moveSequenceUp = (r, e) => {
    e.stopPropagation()
    const bySeq = [...list].sort((a, b) => (a.sequence ?? 999) - (b.sequence ?? 999))
    const i = bySeq.findIndex((row) => row.id === r.id)
    if (i <= 0) return
    ;[bySeq[i - 1], bySeq[i]] = [bySeq[i], bySeq[i - 1]]
    const renumbered = bySeq.map((row, idx) => ({ ...row, sequence: idx + 1 }))
    setList(renumbered)
  }

  const moveSequenceDown = (r, e) => {
    e.stopPropagation()
    const bySeq = [...list].sort((a, b) => (a.sequence ?? 999) - (b.sequence ?? 999))
    const i = bySeq.findIndex((row) => row.id === r.id)
    if (i < 0 || i >= bySeq.length - 1) return
    ;[bySeq[i], bySeq[i + 1]] = [bySeq[i + 1], bySeq[i]]
    const renumbered = bySeq.map((row, idx) => ({ ...row, sequence: idx + 1 }))
    setList(renumbered)
  }

  const handleBerthClick = (berthId) => {
    const berth = berthsState.find((b) => b.id === berthId)
    if (berth?.currentVesselId) setVesselDetailModalVesselId(berth.currentVesselId)
  }

  /** Resolve row.jetty to a single berth id (e.g. "1A" or "1A/2A" → "1A") */
  const getTargetJettyId = (row) => {
    const raw = (row.jetty || '').trim()
    return raw.split('/')[0].trim() || null
  }

  const handleBerthingConfirm = () => {
    if (!berthingConfirmRow) return
    const targetJettyId = (berthingSelectedJetty || '').trim()
    const errors = []
    if (!targetJettyId) {
      errors.push('Please select a jetty.')
    } else {
      const berth = berthsState.find((b) => b.id === targetJettyId)
      if (!berth) {
        errors.push(`Jetty ${targetJettyId} not found.`)
      } else if (berth.currentVesselId) {
        const occupantName = getVesselName(berth.currentVesselId)
        errors.push(`Jetty ${targetJettyId} is occupied by ${occupantName}. Please choose another jetty.`)
      }
    }
    if (berthingPhotos.length === 0) {
      errors.push('Please upload at least one vessel photo.')
    }
    if (!(berthingRemarks || '').trim()) {
      errors.push('Please enter a remark.')
    }
    if (errors.length > 0) {
      setBerthingErrors(errors)
      return
    }
    setBerthingErrors([])
    setVesselPhotosByVesselId((prev) => ({
      ...prev,
      [berthingConfirmRow.vesselId]: berthingPhotos.map((p) => ({ url: p.previewUrl, name: p.file.name })),
    }))
    setBerthsState((prev) =>
      prev.map((b) => (b.id === targetJettyId ? { ...b, currentVesselId: berthingConfirmRow.vesselId } : b))
    )
    setList((prev) => {
      const next = prev.filter((r) => r.id !== berthingConfirmRow.id)
      return next.map((row, i) => ({ ...row, sequence: i + 1 }))
    })
    const vesselName = berthingConfirmRow.vesselName || 'Vessel'
    setBerthingSuccessMessage(`${vesselName} has been allocated to Jetty ${targetJettyId}. Berthing completed successfully.`)
    closeBerthingConfirm(true)
  }

  const openBerthingConfirm = (r, e) => {
    e.stopPropagation()
    setBerthingErrors([])
    setBerthingConfirmRow(r)
    setBerthingSelectedJetty(getTargetJettyId(r) || '')
    setBerthingPob(r.pobDateTime || '')
    setBerthingTb(getNowForDateTimeLocal())
    setBerthingSob(r.sobDateTime || '')
    setBerthingPhotos([])
    setBerthingRemarks(r.remark ?? r.remarks ?? '')
  }

  const closeBerthingConfirm = (skipRevoke = false) => {
    if (!skipRevoke) {
      berthingPhotos.forEach((p) => {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl)
      })
    }
    setBerthingConfirmRow(null)
    setBerthingErrors([])
    setBerthingSelectedJetty('')
    setBerthingPob('')
    setBerthingTb('')
    setBerthingSob('')
    setBerthingPhotos([])
    setBerthingRemarks('')
  }

  const addBerthingPhotos = (e) => {
    const files = Array.from(e.target.files || [])
    const newPhotos = files.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }))
    setBerthingPhotos((prev) => [...prev, ...newPhotos])
    e.target.value = ''
  }

  const removeBerthingPhoto = (id) => {
    setBerthingPhotos((prev) => {
      const p = prev.find((x) => x.id === id)
      if (p?.previewUrl) URL.revokeObjectURL(p.previewUrl)
      return prev.filter((x) => x.id !== id)
    })
  }

  useEffect(() => {
    if (!vesselDetailModalVesselId) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setVesselDetailModalVesselId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [vesselDetailModalVesselId])

  useEffect(() => {
    if (!arrivalUpdateForm) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setArrivalUpdateForm(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [arrivalUpdateForm])

  useEffect(() => {
    if (!berthingConfirmRow) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') closeBerthingConfirm()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [berthingConfirmRow])

  useEffect(() => {
    if (!berthingSuccessMessage) return
    const t = setTimeout(() => setBerthingSuccessMessage(null), 5000)
    return () => clearTimeout(t)
  }, [berthingSuccessMessage])

  const updateFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }))
  const handleSort = (key) => setSortState((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))

  const filteredList = list.filter((r) => {
    return filterKeys.every((key) => {
      const f = (filters[key] || '').trim().toLowerCase()
      if (!f) return true
      const val = r[key]
      return String(val ?? '').toLowerCase().includes(f)
    })
  })

  const sortedList = [...filteredList].sort((a, b) => {
    const col = ALLOCATION_COLUMNS.find((c) => c.key === sortState.key)
    if (!col) return 0
    const va = col.getSortValue(a)
    const vb = col.getSortValue(b)
    const isNum = typeof va === 'number' && typeof vb === 'number'
    const cmp = isNum ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true })
    return sortState.dir === 'asc' ? cmp : -cmp
  })

  return (
    <div className="allocation-page">
      {berthingSuccessMessage && (
        <div
          className="toast toast--success"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="toast__icon" aria-hidden>✓</span>
          <p className="toast__message">{berthingSuccessMessage}</p>
          <button
            type="button"
            className="toast__close"
            onClick={() => setBerthingSuccessMessage(null)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      )}

      <h1 className="page-title">Allocation & Berthing</h1>

      <div className="allocation-visual">
        <div className="allocation-tabs" role="tablist" aria-label="Visualization">
          <button
            type="button"
            role="tab"
            aria-selected={visualTab === 'schematic'}
            aria-controls="allocation-panel-schematic"
            id="allocation-tab-schematic"
            className={`allocation-tabs__tab ${visualTab === 'schematic' ? 'allocation-tabs__tab--active' : ''}`}
            onClick={() => setVisualTab('schematic')}
          >
            Jetty schematic
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={visualTab === 'schedule'}
            aria-controls="allocation-panel-schedule"
            id="allocation-tab-schedule"
            className={`allocation-tabs__tab ${visualTab === 'schedule' ? 'allocation-tabs__tab--active' : ''}`}
            onClick={() => setVisualTab('schedule')}
          >
            Upcoming schedule
          </button>
        </div>
        <div
          id="allocation-panel-schematic"
          role="tabpanel"
          aria-labelledby="allocation-tab-schematic"
          hidden={visualTab !== 'schematic'}
          className="allocation-tabpanel"
        >
          <JettySchematic berths={berthsState} onSelectBerth={handleBerthClick} />
        </div>
        <div
          id="allocation-panel-schedule"
          role="tabpanel"
          aria-labelledby="allocation-tab-schedule"
          hidden={visualTab !== 'schedule'}
          className="allocation-tabpanel"
        >
          <section className="card allocation-schedule">
            <h2 className="allocation-schedule__title">72-Hour berth schedule</h2>
            <div className="allocation-schedule__legend">
              <span className="allocation-schedule__legend-item">
                <span className="allocation-schedule__legend-dot allocation-schedule__legend-dot--active" /> Active
              </span>
              <span className="allocation-schedule__legend-item">
                <span className="allocation-schedule__legend-dot allocation-schedule__legend-dot--berthing" /> Berthing
              </span>
              <span className="allocation-schedule__legend-item">
                <span className="allocation-schedule__legend-dot allocation-schedule__legend-dot--expected" /> Expected
              </span>
            </div>
            <div className="allocation-schedule__table-wrap">
              <table className="allocation-schedule__table">
                <thead>
                  <tr>
                    <th className="allocation-schedule__th-id">JETTY ID</th>
                    {scheduleData.slotLabels.map((label, i) => (
                      <th key={i} className="allocation-schedule__th-slot">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {BERTH_IDS.map((jettyId) => {
                    const berth = berthsState.find((b) => b.id === jettyId)
                    const statusLabel = berth?.currentVesselId ? 'Occupied' : 'Ready'
                    return (
                      <tr key={jettyId}>
                        <td className="allocation-schedule__cell-id">
                          <span className="allocation-schedule__jetty-id">{jettyId}</span>
                          <span className="allocation-schedule__jetty-status">Status: {statusLabel}</span>
                        </td>
                        {Array.from({ length: SLOTS_COUNT }, (_, slotIndex) => {
                          const cell = getOccupancyInSlot(scheduleData.occupancies, jettyId, slotIndex)
                          if (cell === 'continued') return null
                          if (cell) {
                            return (
                              <td key={slotIndex} colSpan={cell.span} className="allocation-schedule__cell allocation-schedule__cell--vessel">
                                <span className={`allocation-schedule__pill allocation-schedule__pill--${(cell.status || '').toLowerCase()}`}>
                                  {(cell.status === 'Expected' || cell.status === 'Berthing') && (
                                    <span className="allocation-schedule__pill-icon" aria-hidden>🚢</span>
                                  )}
                                  {cell.vesselName}
                                </span>
                              </td>
                            )
                          }
                          return <td key={slotIndex} className="allocation-schedule__cell" />
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      {/* Active Vessel Detail modal (opens when user clicks an occupied ship block) */}
      {vesselDetailModalVesselId && (
        <div
          className="modal-overlay"
          onClick={() => setVesselDetailModalVesselId(null)}
          aria-hidden="true"
        >
          <div
            className="modal modal--wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="vessel-detail-modal-title"
            aria-modal="true"
          >
            <h2 id="vessel-detail-modal-title" className="modal__title">
              ⚓ Active Vessel Detail: {getVesselName(vesselDetailModalVesselId)}
            </h2>
            {(() => {
              const vessel = vessels[vesselDetailModalVesselId]
              const purpose = (vessel?.purpose ?? '').toString().trim()
              const phases = UNIFIED_PHASES
              const loadingSteps = purpose === 'Loading' ? getLoadingSteps(vesselDetailModalVesselId) : null
              const currentPhaseIndex = purpose === 'Loading' && loadingSteps
                ? getLoadingPhaseIndex(loadingSteps)
                : (vessel?.currentPhaseIndex ?? 0)
              const formatDateTime = (val) => {
                if (val == null || val === '') return '—'
                if (typeof val === 'string' && val.includes('T')) return new Date(val).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
                return String(val)
              }
              const eta = formatDateTime(vessel?.eta)
              const ta = formatDateTime(vessel?.ta)
              const etb = formatDateTime(vessel?.etb)
              const tb = formatDateTime(vessel?.tb)
              const timeSinceBerthing = vessel?.timeSinceDocking ?? '—'
              const estCompletion = formatDateTime(vessel?.estCompletion)
              const estTimeRemaining = vessel?.estTimeRemaining ?? '—'
              return (
                <div className="vessel-detail-modal__body">
                  <section className="berthing-modal__card berthing-modal__card--vessel">
                    <h3 className="berthing-modal__card-title">Vessel info</h3>
                    <dl className="berthing-modal__vessel-dl">
                      <div className="berthing-modal__vessel-row">
                        <dt>Vessel name</dt>
                        <dd className="berthing-modal__vessel-dl--bold">{vessel?.vesselName || '—'}</dd>
                      </div>
                      <div className="berthing-modal__vessel-row">
                        <dt>SI No</dt>
                        <dd className="berthing-modal__vessel-dl--bold">{vessel?.siId || '—'}</dd>
                      </div>
                      <div className="berthing-modal__vessel-row">
                        <dt>Purpose</dt>
                        <dd>{vessel?.purpose || '—'}</dd>
                      </div>
                      <div className="berthing-modal__vessel-row">
                        <dt>Material</dt>
                        <dd>{vessel?.product || '—'}</dd>
                      </div>
                    </dl>
                  </section>

                  <section className="berthing-modal__card">
                    <h3 className="berthing-modal__card-title">Current Phase</h3>
                    <div className="phase-stepper" role="list" aria-label="Current phase steps">
                      {phases.map((label, index) => {
                        const isCompleted = index < currentPhaseIndex
                        const isCurrent = index === currentPhaseIndex
                        const state = isCompleted ? 'completed' : isCurrent ? 'in-progress' : 'not-started'
                        const isPlainStep = label === 'Allocation' || label === 'Berthing'
                        const content = isPlainStep ? (
                          <span className="phase-stepper__step-label">{label}</span>
                        ) : (
                          <Link to={getPhaseLink(label, vesselDetailModalVesselId, purpose) || '#'} className="phase-stepper__step-label phase-stepper__step-label--link">
                            {label}
                          </Link>
                        )
                        return (
                          <Fragment key={index}>
                            <div
                              className={`phase-stepper__step phase-stepper__step--${state}`}
                              role="listitem"
                              aria-current={isCurrent ? 'step' : undefined}
                            >
                              <span className="phase-stepper__circle" aria-hidden="true" />
                              {isCurrent && <span className="phase-stepper__current-mark" aria-hidden="true">●</span>}
                              {content}
                            </div>
                            {index < phases.length - 1 && (
                              <span className="phase-stepper__connector" aria-hidden="true">→</span>
                            )}
                          </Fragment>
                        )
                      })}
                    </div>
                  </section>

                  <section className="berthing-modal__card berthing-modal__card--vessel">
                    <h3 className="berthing-modal__card-title">Times & status</h3>
                    <dl className="berthing-modal__vessel-dl">
                      <div className="berthing-modal__vessel-row">
                        <dt>Estimated Time of Arrival (ETA)</dt>
                        <dd>{eta}</dd>
                      </div>
                      <div className="berthing-modal__vessel-row">
                        <dt>Actual Time of Arrival (TA)</dt>
                        <dd>{ta}</dd>
                      </div>
                      <div className="berthing-modal__vessel-row">
                        <dt>Estimated Time of Berthing (ETB)</dt>
                        <dd>{etb}</dd>
                      </div>
                      <div className="berthing-modal__vessel-row">
                        <dt>Actual Time of Berthing (TB)</dt>
                        <dd>{tb}</dd>
                      </div>
                      <div className="berthing-modal__vessel-row">
                        <dt>Time Since Berthing</dt>
                        <dd>{timeSinceBerthing}</dd>
                      </div>
                      <div className="berthing-modal__vessel-row">
                        <dt>Est. Completion</dt>
                        <dd>{estCompletion}</dd>
                      </div>
                      <div className="berthing-modal__vessel-row">
                        <dt>Est. Time Remaining</dt>
                        <dd>{estTimeRemaining}</dd>
                      </div>
                    </dl>
                  </section>

                  <section className="berthing-modal__card">
                    <h3 className="berthing-modal__card-title">Allocation &amp; Berthing events</h3>
                    <p className="loading-tab-hint" style={{ marginBottom: 'var(--spacing-2)' }}>
                      Allocation: VESSEL ARRIVED, DROP ANCHORED, NOR TENDERED. Berthing: POB, ALL FAST, SOB.
                    </p>
                    <dl className="berthing-modal__vessel-dl">
                      {ALLOCATION_EVENTS.map((ev) => (
                        <div key={ev} className="berthing-modal__vessel-row">
                          <dt>{ev}</dt>
                          <dd>—</dd>
                        </div>
                      ))}
                      {BERTHING_EVENTS.map((ev) => (
                        <div key={ev} className="berthing-modal__vessel-row">
                          <dt>{ev}</dt>
                          <dd>—</dd>
                        </div>
                      ))}
                    </dl>
                  </section>

                  {vesselPhotosByVesselId[vesselDetailModalVesselId]?.length > 0 && (
                    <section className="berthing-modal__card">
                      <h3 className="berthing-modal__card-title">Vessel photos</h3>
                      <ul className="vessel-detail-modal__photos">
                        {vesselPhotosByVesselId[vesselDetailModalVesselId].map((photo, i) => (
                          <li key={i} className="vessel-detail-modal__photo-item">
                            <img src={photo.url} alt={photo.name || 'Vessel'} className="vessel-detail-modal__photo-img" />
                            {photo.name && <span className="vessel-detail-modal__photo-caption">{photo.name}</span>}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                </div>
              )
            })()}
            <div className="modal__footer">
              <button type="button" className="btn btn--primary" onClick={() => setVesselDetailModalVesselId(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Berthing confirmation modal (extended: jetty allocation, vessel photos, remarks) */}
      {berthingConfirmRow && (
        <div
          className="modal-overlay"
          onClick={closeBerthingConfirm}
          aria-hidden="true"
        >
          <div
            className="modal modal--wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="berthing-confirm-title"
            aria-modal="true"
          >
            <h2 id="berthing-confirm-title" className="modal__title">
              Confirm Berthing
            </h2>

            <div className="berthing-modal__body">
              <div className="berthing-modal__col-vessel">
                <section className="berthing-modal__card berthing-modal__card--vessel">
                  <h3 className="berthing-modal__card-title">Vessel info</h3>
                  <dl className="berthing-modal__vessel-dl">
                    <div className="berthing-modal__vessel-row">
                      <dt>Vessel name</dt>
                      <dd className="berthing-modal__vessel-dl--bold">{berthingConfirmRow.vesselName || '—'}</dd>
                    </div>
                    <div className="berthing-modal__vessel-row">
                      <dt>SI No</dt>
                      <dd className="berthing-modal__vessel-dl--bold">{berthingConfirmRow.shippingInstruction || '—'}</dd>
                    </div>
                    <div className="berthing-modal__vessel-row">
                      <dt>Surveyor</dt>
                      <dd>{berthingConfirmRow.surveyor || '—'}</dd>
                    </div>
                    <div className="berthing-modal__vessel-row">
                      <dt>Current jetty</dt>
                      <dd>{getTargetJettyId(berthingConfirmRow) || '—'}</dd>
                    </div>
                  </dl>
                </section>
              </div>

              <div className="berthing-modal__col-form">
                <section className="berthing-modal__form-section">
                  <h3 className="berthing-modal__form-section-title">Berthing details</h3>
                  <div className="berthing-modal__field">
                    <label htmlFor="berthing-jetty" className="berthing-modal__label">Jetty allocation</label>
                    <select
                      id="berthing-jetty"
                      className="berthing-modal__input"
                      value={berthingSelectedJetty}
                      onChange={(e) => setBerthingSelectedJetty(e.target.value)}
                      aria-describedby={berthingErrors.length > 0 ? 'berthing-errors' : undefined}
                    >
                      <option value="">— Select jetty —</option>
                      {BERTH_IDS.map((jid) => {
                        const b = berthsState.find((bb) => bb.id === jid)
                        const label = b?.currentVesselId ? `${jid} – ${getVesselName(b.currentVesselId)}` : `${jid} – Vacant`
                        return (
                          <option key={jid} value={jid}>
                            {label}
                          </option>
                        )
                      })}
                    </select>
                  </div>
                  <div className="berthing-modal__field">
                    <label htmlFor="berthing-pob" className="berthing-modal__label">Pilot on Board (POB)</label>
                    <input
                      id="berthing-pob"
                      type="datetime-local"
                      className="berthing-modal__input"
                      value={berthingPob}
                      onChange={(e) => setBerthingPob(e.target.value)}
                      aria-label="Pilot on Board"
                    />
                  </div>
                  <div className="berthing-modal__field">
                    <label htmlFor="berthing-tb" className="berthing-modal__label">Actual Time of Berthing (TB)</label>
                    <input
                      id="berthing-tb"
                      type="datetime-local"
                      className="berthing-modal__input"
                      value={berthingTb}
                      onChange={(e) => setBerthingTb(e.target.value)}
                      aria-label="Actual Time of Berthing"
                    />
                  </div>
                  <div className="berthing-modal__field">
                    <label htmlFor="berthing-sob" className="berthing-modal__label">Surveyor on Board (SOB)</label>
                    <input
                      id="berthing-sob"
                      type="datetime-local"
                      className="berthing-modal__input"
                      value={berthingSob}
                      onChange={(e) => setBerthingSob(e.target.value)}
                      aria-label="Surveyor on Board"
                    />
                  </div>
                </section>

                <section className="berthing-modal__form-section">
                  <label className="berthing-modal__label">Vessel photo (at least one required)</label>
                  <label htmlFor="berthing-photos" className="berthing-modal__file-zone">
                    <span className="berthing-modal__file-zone-text">
                      {berthingPhotos.length > 0 ? `${berthingPhotos.length} file(s) chosen` : 'Choose files or drop here'}
                    </span>
                    <input
                      id="berthing-photos"
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={addBerthingPhotos}
                      className="berthing-modal__file-input"
                      aria-label="Upload vessel photos"
                    />
                  </label>
                  {berthingPhotos.length > 0 && (
                    <ul className="berthing-modal__photo-list" aria-label="Uploaded vessel photos">
                      {berthingPhotos.map((p) => (
                        <li key={p.id} className="berthing-modal__photo-item">
                          <img src={p.previewUrl} alt={p.file.name} className="berthing-modal__photo-thumb" />
                          <span className="berthing-modal__photo-name" title={p.file.name}>{p.file.name}</span>
                          <button
                            type="button"
                            className="btn btn--small berthing-modal__photo-remove"
                            onClick={() => removeBerthingPhoto(p.id)}
                            aria-label={`Remove ${p.file.name}`}
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="berthing-modal__form-section">
                  <label htmlFor="berthing-remarks" className="berthing-modal__label">Remarks (required)</label>
                  <textarea
                    id="berthing-remarks"
                    className="berthing-modal__textarea"
                    rows={3}
                    value={berthingRemarks}
                    onChange={(e) => setBerthingRemarks(e.target.value)}
                    placeholder="Enter remark for this berthing"
                    aria-describedby={berthingErrors.length > 0 ? 'berthing-errors' : undefined}
                  />
                </section>
              </div>
            </div>

            {berthingErrors.length > 0 && (
              <div id="berthing-errors" className="berthing-modal__errors" role="alert">
                <p className="berthing-modal__errors-title">Please fix the following:</p>
                <ul className="berthing-modal__errors-list">
                  {berthingErrors.map((msg, i) => (
                    <li key={i}>{msg}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="modal__footer">
              <button type="button" className="btn btn--secondary" onClick={closeBerthingConfirm}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleBerthingConfirm}
              >
                Confirm Berthing
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Log arrival update modal (pre-filled from row) */}
      {arrivalUpdateForm && (
        <div
          className="modal-overlay"
          onClick={() => setArrivalUpdateForm(null)}
          aria-hidden="true"
        >
          <div
            className="modal modal--wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="arrival-update-modal-title"
            aria-modal="true"
          >
            <h2 id="arrival-update-modal-title" className="modal__title">
              Log arrival update
            </h2>

            <div className="vessel-detail-modal__body">
              <section className="berthing-modal__card berthing-modal__card--vessel">
                <h3 className="berthing-modal__card-title">Vessel info</h3>
                <dl className="berthing-modal__vessel-dl">
                  <div className="berthing-modal__vessel-row">
                    <dt>Vessel name</dt>
                    <dd className="berthing-modal__vessel-dl--bold" aria-live="polite">{arrivalUpdateForm.vesselName || '—'}</dd>
                  </div>
                  <div className="berthing-modal__vessel-row">
                    <dt>SI No</dt>
                    <dd className="berthing-modal__vessel-dl--bold" aria-live="polite">{arrivalUpdateForm.shippingInstruction || '—'}</dd>
                  </div>
                  <div className="berthing-modal__vessel-row">
                    <dt>Material</dt>
                    <dd aria-live="polite">{arrivalUpdateForm.material || (arrivalUpdateForm.shippingTable?.[0]?.material) || '—'}</dd>
                  </div>
                </dl>
              </section>

              <section className="berthing-modal__form-section">
                <h3 className="berthing-modal__form-section-title">Arrival Documents</h3>
                <div className="berthing-modal__field">
                  <label htmlFor="arrival-noPkk" className="berthing-modal__label">No PKK</label>
                  <input
                    id="arrival-noPkk"
                    type="text"
                    className="berthing-modal__input"
                    value={arrivalUpdateForm.noPkk ?? ''}
                    onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, noPkk: e.target.value }))}
                    placeholder="e.g. PKK-2026-001"
                  />
                </div>
                <div className="berthing-modal__field">
                  <label htmlFor="arrival-nor-doc" className="berthing-modal__label">Notice of Readiness</label>
                  <label className="berthing-modal__file-zone" htmlFor="arrival-nor-doc">
                    <span className="berthing-modal__file-zone-text">
                      {arrivalNorFiles.length > 0 ? `${arrivalNorFiles.length} file(s) chosen` : 'Choose NOR document'}
                    </span>
                    <input
                      id="arrival-nor-doc"
                      type="file"
                      accept=".pdf,image/*"
                      multiple
                      onChange={(e) => addArrivalNorFiles(e.target.files)}
                      className="berthing-modal__file-input"
                    />
                  </label>
                  {arrivalNorFiles.length > 0 && (
                    <ul className="berthing-modal__file-list" style={{ marginTop: 'var(--spacing-1)', fontSize: 'var(--font-size-small)', color: 'var(--color-text-steel)' }}>
                      {arrivalNorFiles.map((f, i) => (
                        <li key={i}>{f.name}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="berthing-modal__field">
                  <label htmlFor="arrival-nor-tendered" className="berthing-modal__label">NOR Tendered Date &amp; Time</label>
                  <input
                    id="arrival-nor-tendered"
                    type="datetime-local"
                    className="berthing-modal__input"
                    value={arrivalUpdateForm.norTenderedDateTime || ''}
                    onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, norTenderedDateTime: e.target.value }))}
                  />
                </div>
                <div className="berthing-modal__field">
                  <label htmlFor="arrival-nor-accepted" className="berthing-modal__label">NOR Accepted Date &amp; Time</label>
                  <input
                    id="arrival-nor-accepted"
                    type="datetime-local"
                    className="berthing-modal__input"
                    value={arrivalUpdateForm.norAcceptedDateTime || ''}
                    onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, norAcceptedDateTime: e.target.value }))}
                  />
                  <p className="loading-tab-hint" style={{ marginTop: 'var(--spacing-1)', marginBottom: 0 }}>
                    Starts counting Demurrage SLA.
                  </p>
                </div>
              </section>

              <section className="berthing-modal__form-section">
                <h3 className="berthing-modal__form-section-title">Times & jetty</h3>
                <div className="berthing-modal__field">
                  <label htmlFor="arrival-eta" className="berthing-modal__label">ETA</label>
                  <input
                    id="arrival-eta"
                    type="datetime-local"
                    className="berthing-modal__input"
                    value={arrivalUpdateForm.etaDateTime || ''}
                    onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, etaDateTime: e.target.value }))}
                  />
                </div>
                <div className="berthing-modal__field">
                  <label htmlFor="arrival-ta" className="berthing-modal__label">TA</label>
                  <input
                    id="arrival-ta"
                    type="datetime-local"
                    className="berthing-modal__input"
                    value={arrivalUpdateForm.taDateTime || ''}
                    onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, taDateTime: e.target.value }))}
                  />
                </div>
                <div className="berthing-modal__field">
                  <label htmlFor="arrival-etb" className="berthing-modal__label">ETB</label>
                  <input
                    id="arrival-etb"
                    type="datetime-local"
                    className="berthing-modal__input"
                    value={arrivalUpdateForm.etbDateTime || ''}
                    onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, etbDateTime: e.target.value }))}
                  />
                </div>
                <div className="berthing-modal__field">
                  <label htmlFor="arrival-jetty" className="berthing-modal__label">Jetty</label>
                  <select
                    id="arrival-jetty"
                    className="berthing-modal__input"
                    value={arrivalUpdateForm.jetty || ''}
                    onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, jetty: e.target.value }))}
                  >
                    <option value="">—</option>
                    {BERTH_IDS.map((jid) => (
                      <option key={jid} value={jid}>{jid}</option>
                    ))}
                  </select>
                </div>
              </section>

              <section className="berthing-modal__form-section">
                <label htmlFor="arrival-remarks" className="berthing-modal__label">Remarks</label>
                <textarea
                  id="arrival-remarks"
                  className="berthing-modal__textarea"
                  rows={3}
                  value={arrivalUpdateForm.remark ?? arrivalUpdateForm.remarks ?? ''}
                  onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, remark: e.target.value }))}
                  placeholder="e.g. Dropped anchor 12/02 01:10; ETB after BG. SMS 3000 at Jetty 2B; Source: WhatsApp"
                />
              </section>
            </div>

            <div className="modal__footer">
              <button type="button" className="btn btn--secondary" onClick={() => setArrivalUpdateForm(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" onClick={saveArrivalUpdate}>
                Save update
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="card">
        <h2 className="card__title">Incoming vessel & berthing plan</h2>
        <div className="table-wrap">
          <table className="data-table allocation-table">
            <thead>
              <tr>
                <th className="allocation-table__expand-col"></th>
                <th className="allocation-table__action-col">Action</th>
                {ALLOCATION_COLUMNS.map((col) => (
                  <th key={col.key} className="allocation-table__th">
                    <button
                      type="button"
                      className="allocation-table__sort"
                      onClick={() => handleSort(col.key)}
                      title={`Sort by ${col.label}`}
                    >
                      {col.label}
                      <span className="allocation-table__sort-icon">
                        {sortState.key === col.key ? (sortState.dir === 'asc' ? ' ↑' : ' ↓') : ' ⇅'}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
              <tr className="allocation-table__filter-row">
                <th className="allocation-table__expand-col"></th>
                <th className="allocation-table__action-col"></th>
                {ALLOCATION_COLUMNS.map((col) => (
                  <th key={col.key}>
                    <input
                      type="text"
                      className="allocation-table__filter"
                      placeholder={`Filter ${col.label}`}
                      value={filters[col.key]}
                      onChange={(e) => updateFilter(col.key, e.target.value)}
                      aria-label={`Filter by ${col.label}`}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedList.map((r) => (
                <Fragment key={r.id}>
                  <tr
                    className={`allocation-table__row ${expandedId === r.id ? 'allocation-table__row--expanded' : ''}`}
                    onClick={() => setExpandedId((id) => (id === r.id ? null : r.id))}
                  >
                    <td className="allocation-table__expand-col">
                      <span className="allocation-table__expand-icon" aria-hidden>
                        {expandedId === r.id ? '▼' : '▶'}
                      </span>
                    </td>
                    <td className="allocation-table__action-col" onClick={(e) => e.stopPropagation()}>
                      <div className="allocation-table__action-btns">
                        <button type="button" className="btn btn--primary btn--small" onClick={() => openArrivalUpdate(r)}>
                          Log arrival update
                        </button>
                        <button type="button" className="btn btn--success btn--small" onClick={(e) => openBerthingConfirm(r, e)}>
                          Berthing
                        </button>
                      </div>
                    </td>
                    {ALLOCATION_COLUMNS.map((col) => (
                      <td key={col.key} onClick={col.key === 'sequence' ? (e) => e.stopPropagation() : undefined}>
                        {col.key === 'sequence' ? (
                          <span className="allocation-table__sequence-cell">
                            <span className="allocation-table__sequence-num">{r.sequence ?? '—'}</span>
                            <span className="allocation-table__sequence-btns">
                              <button
                                type="button"
                                className="btn btn--small allocation-table__sequence-btn"
                                onClick={(e) => moveSequenceUp(r, e)}
                                disabled={sortedList.findIndex((x) => x.id === r.id) <= 0}
                                title="Move up"
                                aria-label="Move berthing sequence up"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="btn btn--small allocation-table__sequence-btn"
                                onClick={(e) => moveSequenceDown(r, e)}
                                disabled={sortedList.findIndex((x) => x.id === r.id) >= sortedList.length - 1}
                                title="Move down"
                                aria-label="Move berthing sequence down"
                              >
                                ↓
                              </button>
                            </span>
                          </span>
                        ) : (
                          col.getValue(r)
                        )}
                      </td>
                    ))}
                  </tr>
                  {expandedId === r.id && (
                    <tr className="allocation-table__detail-row">
                      <td colSpan={ALLOCATION_COLUMNS.length + 2} className="allocation-table__detail-cell">
                        <div className="allocation-detail">
                          <h4 className="allocation-detail__title">Full details</h4>
                          <dl className="allocation-detail__grid">
                            <dt>Vessel Name</dt><dd>{r.vesselName || '—'}</dd>
                            <dt>Shipping Instruction</dt><dd>{r.shippingInstruction || '—'}</dd>
                            <dt>No PKK</dt><dd>{r.noPkk ?? '—'}</dd>
                            <dt>Priority</dt><dd>{r.priority || '—'}</dd>
                            <dt>Number of Palka</dt><dd>{r.numberOfPalka ?? '—'}</dd>
                            <dt>Purpose</dt><dd>{r.purpose || (r.loadDischarge === 'LOAD' ? 'Loading' : r.loadDischarge === 'DISCH' ? 'Unloading' : r.loadDischarge) || '—'}</dd>
                            <dt>Shipper</dt><dd>{r.shipper || '—'}</dd>
                          </dl>
                          {Array.isArray(r.shippingTable) && r.shippingTable.length > 0 && (
                            <div className="allocation-detail__shipping-table-wrap">
                              <h5 className="allocation-detail__subtitle">Shipping Table</h5>
                              <table className="data-table allocation-detail__shipping-table">
                                <thead>
                                  <tr>
                                    <th>Contract</th>
                                    <th>PO</th>
                                    <th>Material</th>
                                    <th>QTY</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {r.shippingTable.map((row, i) => (
                                    <tr key={i}>
                                      <td>{row.contract ?? '—'}</td>
                                      <td>{row.po ?? '—'}</td>
                                      <td>{row.material ?? '—'}</td>
                                      <td>{row.qty ?? '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                          <dl className="allocation-detail__grid">
                            <dt>Agent</dt><dd>{r.agent || '—'}</dd>
                            <dt>Surveyor</dt><dd>{r.surveyor || '—'}</dd>
                            <dt>Estimated Time of Arrival (ETA)</dt><dd>{r.eta || '—'}</dd>
                            <dt>Estimated Time of Berthing (ETB)</dt><dd>{r.etb || '—'}</dd>
                            <dt>Jetty</dt><dd>{r.jetty || '—'}</dd>
                            <dt>Remark</dt><dd>{r.remark || r.remarks || '—'}</dd>
                          </dl>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
