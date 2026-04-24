import { useState } from 'react'
import {
  berths,
  vessels,
  getPalkaCount,
  getPalkaMock,
  OFFLOADING_ACTIVITY_TAGS,
} from '../data/mockData'
import '../styles/offloading.css'
import { MAX_REMARK_CHARS } from '../constants/inputLimits'

const activeBerths = Array.isArray(berths) ? berths.filter((b) => b && b.currentVesselId) : []

const STAGES = [
  { id: 'A', label: 'Arrival & Connection', short: 'A' },
  { id: 'B', label: 'Active Discharge', short: 'B' },
  { id: 'C', label: 'Stripping & Cleaning', short: 'C' },
  { id: 'D', label: 'Line Clearance', short: 'D' },
]

/** Which activity keys belong to which stage (for timesheet filtering) */
const ACTIVITY_KEYS_BY_STAGE = {
  A: ['hose-on', 'surveyor-check'],
  B: ['commence', 'temporary-stop', 'resume', 'booster-on', 'booster-off'],
  C: ['cleaning-temporary-stop', 'cleaning-resume', 'crew-on-board'],
  D: ['blow-hose', 'vacuum', 'final-blow'],
}

const ACTIVITY_LABELS = {
  'hose-on': 'Hose On',
  'surveyor-check': 'Surveyor Check',
  'commence': 'Commence',
  'temporary-stop': 'Temporary Stop Discharge',
  'resume': 'Resume Discharge',
  'booster-on': 'Booster On',
  'booster-off': 'Booster Off',
  'cleaning-temporary-stop': 'Temporary Stop (Cleaning)',
  'cleaning-resume': 'Resume (Cleaning)',
  'crew-on-board': 'Crew On-Board',
  'blow-hose': 'Blow Hose',
  'vacuum': 'Vacuum',
  'final-blow': 'Final Blow',
}

/** Dummy timesheet rows per stage (1–2 rows so table is never empty) */
const DUMMY_TIMESHEET_ROWS = {
  A: [
    { time: '2026-02-19T09:15:00', activityKey: 'hose-on', tagId: null, comment: 'Connection completed' },
    { time: '2026-02-19T10:00:00', activityKey: 'surveyor-check', tagId: null, comment: 'All clear' },
  ],
  B: [
    { time: '2026-02-19T10:30:00', activityKey: 'commence', tagId: null, comment: '' },
    { time: '2026-02-19T12:00:00', activityKey: 'temporary-stop', tagId: 'break-time', comment: 'Lunch break' },
  ],
  C: [
    { time: '2026-02-19T14:00:00', activityKey: 'crew-on-board', tagId: null, comment: '' },
    { time: '2026-02-19T14:15:00', activityKey: 'cleaning-temporary-stop', tagId: 'cleaning-crew-wait', comment: '' },
  ],
  D: [
    { time: '2026-02-19T16:00:00', activityKey: 'blow-hose', tagId: null, comment: '' },
    { time: '2026-02-19T16:45:00', activityKey: 'vacuum', tagId: null, comment: 'Line cleared' },
  ],
}

function formatTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
}

/** Short format for palka card: DD/MM HH:mm */
function formatTimeShort(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const hours = String(d.getHours()).padStart(2, '0')
  const mins = String(d.getMinutes()).padStart(2, '0')
  return `${day}/${month} ${hours}:${mins}`
}

/** For datetime-local input: ISO string -> YYYY-MM-DDTHH:mm */
function toDateTimeLocal(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 16)
}

/** datetime-local value -> ISO string */
function fromDateTimeLocal(value) {
  if (!value) return new Date().toISOString()
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

export default function Unloading() {
  const [selectedVesselId, setSelectedVesselId] = useState(activeBerths[0]?.currentVesselId ?? null)
  const [stage, setStage] = useState('A')
  const [docking, setDocking] = useState({ arrival: '2026-02-19T08:00', connection: '2026-02-19T09:30' })
  const [activityEvents, setActivityEvents] = useState([])
  const [palkaState, setPalkaState] = useState({})
  const [crewOnBoardAt, setCrewOnBoardAt] = useState(null)
  const [logModal, setLogModal] = useState({
    open: false,
    activityKey: null,
    label: '',
    requiresTag: false,
    timestamp: '',
    comment: '',
    tagId: null,
  })
  const [palkaTimeEdit, setPalkaTimeEdit] = useState(null) // { palkaIndex, action, timestamp } when editing palka P/C/S time

  const vessel = selectedVesselId && vessels ? vessels[selectedVesselId] : null
  const vesselName = (vessel && vessel.vesselName) ?? '—'
  const berth = selectedVesselId && Array.isArray(berths) ? berths.find((b) => b && b.currentVesselId === selectedVesselId) : null
  const jettyName = (berth && berth.name) ?? '—'
  const palkaCount = vessel ? getPalkaCount(vessel) : 0
  const palkaList = selectedVesselId && palkaCount > 0 ? getPalkaMock(selectedVesselId, palkaCount) : []

  const vesselPalkaState = (selectedVesselId && palkaState[selectedVesselId]) || {}

  const getTagLabel = (tagId) => {
    if (!tagId) return '—'
    const tag = OFFLOADING_ACTIVITY_TAGS.find((t) => t.id === tagId)
    return tag ? tag.label : tagId
  }

  /** Build timesheet rows for a stage: real events + palka rows (C only) + dummy rows, sorted by time (newest first) */
  const getTimesheetRowsForStage = (stageId) => {
    const keys = ACTIVITY_KEYS_BY_STAGE[stageId] || []
    const realRows = activityEvents
      .filter((e) => keys.includes(e.activityKey))
      .map((e) => ({
        time: e.timestamp,
        activityLabel: ACTIVITY_LABELS[e.activityKey] ?? e.activityKey,
        tagLabel: getTagLabel(e.tagId),
        comment: e.comment ?? '',
      }))
    let palkaRows = []
    if (stageId === 'C' && palkaList.length > 0) {
      const actionLabels = { P: 'Prepare', C: 'Cleaning', S: 'Signed off' }
      palkaList.forEach((p) => {
        const state = vesselPalkaState[p.index] || {}
        const comment = state.comment ?? ''
        ;['P', 'C', 'S'].forEach((act) => {
          const ts = state[act]
          if (ts) {
            palkaRows.push({
              time: ts,
              activityLabel: `${p.name} - ${actionLabels[act]}`,
              tagLabel: '—',
              comment,
            })
          }
        })
      })
    }
    const dummy = (DUMMY_TIMESHEET_ROWS[stageId] || []).map((d) => ({
      time: d.time,
      activityLabel: ACTIVITY_LABELS[d.activityKey] ?? d.activityKey,
      tagLabel: getTagLabel(d.tagId),
      comment: d.comment ?? '',
    }))
    const combined = [...realRows, ...palkaRows, ...dummy]
    combined.sort((a, b) => new Date(b.time) - new Date(a.time))
    return combined
  }

  const recordActivity = (activityKey, options = {}) => {
    const { tagId = null, timestamp = new Date().toISOString(), comment = '' } = options
    const event = { activityKey, tagId, timestamp, comment: comment || undefined }
    setActivityEvents((prev) => [...prev, event])
    if (activityKey === 'crew-on-board') setCrewOnBoardAt(timestamp)
    setLogModal((m) => ({ ...m, open: false, activityKey: null, label: '', requiresTag: false, timestamp: '', comment: '', tagId: null }))
  }

  const openLogModal = (activityKey, label, requiresTag = false) => {
    const now = toDateTimeLocal(new Date().toISOString())
    setLogModal({
      open: true,
      activityKey,
      label,
      requiresTag,
      timestamp: now,
      comment: '',
      tagId: null,
    })
  }

  const saveLogModal = () => {
    if (!logModal.activityKey) return
    if (logModal.requiresTag && !logModal.tagId) return
    const timestamp = fromDateTimeLocal(logModal.timestamp)
    recordActivity(logModal.activityKey, {
      tagId: logModal.tagId || undefined,
      timestamp,
      comment: logModal.comment.trim() || undefined,
    })
  }

  const setPalkaAction = (palkaIndex, action) => {
    if (!selectedVesselId) return
    setPalkaState((prev) => {
      const byVessel = prev[selectedVesselId] || {}
      const palka = byVessel[palkaIndex] || {}
      const isSet = !!palka[action]
      const nextValue = isSet ? null : new Date().toISOString()
      return {
        ...prev,
        [selectedVesselId]: {
          ...byVessel,
          [palkaIndex]: { ...palka, [action]: nextValue },
        },
      }
    })
  }

  const setPalkaComment = (palkaIndex, comment) => {
    if (!selectedVesselId) return
    setPalkaState((prev) => {
      const byVessel = prev[selectedVesselId] || {}
      const palka = byVessel[palkaIndex] || {}
      return {
        ...prev,
        [selectedVesselId]: {
          ...byVessel,
          [palkaIndex]: { ...palka, comment },
        },
      }
    })
  }

  const updatePalkaActionTimestamp = (palkaIndex, action, newTimestamp) => {
    if (!selectedVesselId) return
    const ts = fromDateTimeLocal(newTimestamp)
    setPalkaState((prev) => {
      const byVessel = prev[selectedVesselId] || {}
      const palka = byVessel[palkaIndex] || {}
      return {
        ...prev,
        [selectedVesselId]: {
          ...byVessel,
          [palkaIndex]: { ...palka, [action]: ts },
        },
      }
    })
    setPalkaTimeEdit(null)
  }

  const openPalkaTimeEdit = (palkaIndex, action, currentTimestamp) => {
    setPalkaTimeEdit({
      palkaIndex,
      action,
      timestamp: toDateTimeLocal(currentTimestamp),
    })
  }

  return (
    <div className="offloading-page">
      <h1 className="page-title">Unloading</h1>
      <p className="offloading-page__intro">
        Select the vessel, then tap a life stage to log arrival, discharge, palka cleaning, and line clearance.
      </p>

      {/* Vessel selector */}
      <section className="card offloading-context">
        <h2 className="card__title">Vessel</h2>
        <div className="offloading-context__row">
          <div className="input-group">
            <label htmlFor="offload-vessel">Ship</label>
            <select
              id="offload-vessel"
              value={selectedVesselId ?? ''}
              onChange={(e) => setSelectedVesselId(e.target.value || null)}
              className="offloading-context__select"
            >
              <option value="">Select vessel</option>
              {activeBerths.map((b) => (
                <option key={b.id} value={b.currentVesselId}>
                  {vessels[b.currentVesselId]?.vesselName} @ {b.name}
                </option>
              ))}
            </select>
          </div>
          {selectedVesselId && (
            <div className="offloading-context__meta">
              <span className="offloading-context__meta-item">Jetty: {jettyName}</span>
              <span className="offloading-context__meta-item">Palkas: {palkaCount}</span>
            </div>
          )}
        </div>
      </section>

      {/* 4-stage navigation */}
      <nav className="offloading-stages" aria-label="Offloading life stages">
        {STAGES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`offloading-stages__btn ${stage === s.id ? 'offloading-stages__btn--active' : ''}`}
            onClick={() => setStage(s.id)}
            aria-pressed={stage === s.id}
          >
            <span className="offloading-stages__letter">{s.short}</span>
            <span className="offloading-stages__label">{s.label}</span>
          </button>
        ))}
      </nav>

      {/* Stage content */}
      <div className="offloading-content">
        {!selectedVesselId ? (
          <p className="text-steel">Select a vessel above to log unloading activities.</p>
        ) : (
          <>
            {/* Stage A: Arrival & Connection */}
            {stage === 'A' && (
              <section className="card">
                <h2 className="card__title">Stage A: Arrival & Connection</h2>
                <div className="offloading-form-grid">
                  <div className="input-group">
                    <label htmlFor="arrival">Actual arrival</label>
                    <input
                      id="arrival"
                      type="datetime-local"
                      value={docking.arrival}
                      onChange={(e) => setDocking((d) => ({ ...d, arrival: e.target.value }))}
                    />
                  </div>
                  <div className="input-group">
                    <label htmlFor="connection">Connection timestamp</label>
                    <input
                      id="connection"
                      type="datetime-local"
                      value={docking.connection}
                      onChange={(e) => setDocking((d) => ({ ...d, connection: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="offloading-milestone-group">
                  <span className="offloading-milestone-label">Hose On</span>
                  <div className="offloading-actions">
                    <button type="button" className="btn btn--primary" onClick={() => openLogModal('hose-on', 'Hose On', false)}>
                      Log now
                    </button>
                    <button type="button" className="btn btn--secondary offloading-log-with-time" onClick={() => openLogModal('hose-on', 'Hose On', false)}>
                      Log with time…
                    </button>
                  </div>
                </div>
                <div className="offloading-milestone-group">
                  <span className="offloading-milestone-label">Surveyor Check</span>
                  <div className="offloading-actions">
                    <button type="button" className="btn btn--primary" onClick={() => openLogModal('surveyor-check', 'Surveyor Check', false)}>
                      Log now
                    </button>
                    <button type="button" className="btn btn--secondary offloading-log-with-time" onClick={() => openLogModal('surveyor-check', 'Surveyor Check', false)}>
                      Log with time…
                    </button>
                  </div>
                </div>
                <div className="offloading-timesheet">
                  <h3 className="offloading-timesheet__title">Timesheet activity</h3>
                  <table className="offloading-timesheet__table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Activity</th>
                        <th>Tag</th>
                        <th>Comment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getTimesheetRowsForStage('A').map((row, i) => (
                        <tr key={`A-${i}`}>
                          <td>{formatTime(row.time)}</td>
                          <td>{row.activityLabel}</td>
                          <td>{row.tagLabel}</td>
                          <td>{row.comment}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Stage B: Active Discharge */}
            {stage === 'B' && (
              <section className="card">
                <h2 className="card__title">Stage B: Active Discharge</h2>
                <p className="offloading-content__hint">Log now (current time) or Log with time… (post-entry). Stop/Resume require a reason tag.</p>
                <div className="offloading-milestone-group">
                  <span className="offloading-milestone-label">Commence</span>
                  <div className="offloading-actions">
                    <button type="button" className="btn btn--primary" onClick={() => openLogModal('commence', 'Commence', false)}>Log now</button>
                    <button type="button" className="btn btn--secondary offloading-log-with-time" onClick={() => openLogModal('commence', 'Commence', false)}>Log with time…</button>
                  </div>
                </div>
                <div className="offloading-milestone-group">
                  <span className="offloading-milestone-label">Temporary Stop</span>
                  <div className="offloading-actions">
                    <button type="button" className="btn btn--primary" onClick={() => openLogModal('temporary-stop', 'Temporary Stop Discharge', true)}>Log now</button>
                    <button type="button" className="btn btn--secondary offloading-log-with-time" onClick={() => openLogModal('temporary-stop', 'Temporary Stop Discharge', true)}>Log with time…</button>
                  </div>
                </div>
                <div className="offloading-milestone-group">
                  <span className="offloading-milestone-label">Resume</span>
                  <div className="offloading-actions">
                    <button type="button" className="btn btn--primary" onClick={() => openLogModal('resume', 'Resume Discharge', true)}>Log now</button>
                    <button type="button" className="btn btn--secondary offloading-log-with-time" onClick={() => openLogModal('resume', 'Resume Discharge', true)}>Log with time…</button>
                  </div>
                </div>
                <div className="offloading-milestone-group">
                  <span className="offloading-milestone-label">Booster On</span>
                  <div className="offloading-actions">
                    <button type="button" className="btn btn--primary" onClick={() => openLogModal('booster-on', 'Booster On', false)}>Log now</button>
                    <button type="button" className="btn btn--secondary offloading-log-with-time" onClick={() => openLogModal('booster-on', 'Booster On', false)}>Log with time…</button>
                  </div>
                </div>
                <div className="offloading-milestone-group">
                  <span className="offloading-milestone-label">Booster Off</span>
                  <div className="offloading-actions">
                    <button type="button" className="btn btn--primary" onClick={() => openLogModal('booster-off', 'Booster Off', false)}>Log now</button>
                    <button type="button" className="btn btn--secondary offloading-log-with-time" onClick={() => openLogModal('booster-off', 'Booster Off', false)}>Log with time…</button>
                  </div>
                </div>
                <div className="offloading-timesheet">
                  <h3 className="offloading-timesheet__title">Timesheet activity</h3>
                  <table className="offloading-timesheet__table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Activity</th>
                        <th>Tag</th>
                        <th>Comment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getTimesheetRowsForStage('B').map((row, i) => (
                        <tr key={`B-${i}`}>
                          <td>{formatTime(row.time)}</td>
                          <td>{row.activityLabel}</td>
                          <td>{row.tagLabel}</td>
                          <td>{row.comment}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Stage C: Stripping & Cleaning */}
            {stage === 'C' && (
              <section className="card">
                <h2 className="card__title">Stage C: Stripping & Cleaning ({vesselName})</h2>
                <p className="offloading-content__hint">
                  Tap P (Prepare), C (Cleaning), S (Signed off) for each palka. Click a timestamp to edit. Log temporary stop/resume for breaks.
                </p>
                <div className="offloading-milestone-group">
                  <span className="offloading-milestone-label">Temporary Stop (Cleaning) / Resume</span>
                  <div className="offloading-actions">
                    <button type="button" className="btn btn--secondary" onClick={() => openLogModal('cleaning-temporary-stop', 'Temporary Stop (Cleaning)', true)}>Log now</button>
                    <button type="button" className="btn btn--secondary" onClick={() => openLogModal('cleaning-resume', 'Resume (Cleaning)', true)}>Log now</button>
                  </div>
                </div>
                <div className="offloading-milestone-group" style={{ marginBottom: 'var(--spacing-4)' }}>
                  <span className="offloading-milestone-label">Crew On-Board {crewOnBoardAt ? `(${formatTime(crewOnBoardAt)})` : ''}</span>
                  <div className="offloading-actions">
                    <button type="button" className="btn btn--primary" onClick={() => openLogModal('crew-on-board', 'Crew On-Board', false)}>Log now</button>
                    <button type="button" className="btn btn--secondary offloading-log-with-time" onClick={() => openLogModal('crew-on-board', 'Crew On-Board', false)}>Log with time…</button>
                  </div>
                </div>
                <div className="palka-dynamic-grid">
                  {palkaList.map((p) => {
                    const state = vesselPalkaState[p.index] || {}
                    return (
                      <div key={p.id} className="palka-dynamic-card">
                        <span className="palka-dynamic-card__name">{p.name}</span>
                        <div className="palka-dynamic-card__actions">
                          {(['P', 'C', 'S']).map((act) => {
                            const label = act === 'P' ? 'Prepare' : act === 'C' ? 'Cleaning' : 'Signed off'
                            const ts = state[act]
                            return (
                              <div key={act} className="palka-dynamic-card__action-cell">
                                <button
                                  type="button"
                                  className={`btn btn--small ${ts ? 'btn--primary' : 'btn--secondary'}`}
                                  onClick={() => setPalkaAction(p.index, act)}
                                  title={label}
                                >
                                  {act} {ts ? '✓' : ''}
                                </button>
                                {ts ? (
                                  <button
                                    type="button"
                                    className="palka-dynamic-card__time"
                                    onClick={(e) => { e.stopPropagation(); openPalkaTimeEdit(p.index, act, ts) }}
                                    title={`Edit ${act} time`}
                                  >
                                    {formatTimeShort(ts)}
                                  </button>
                                ) : null}
                              </div>
                            )
                          })}
                        </div>
                        <div className="palka-dynamic-card__comment">
                          <label htmlFor={`palka-comment-${p.index}`} className="visually-hidden">Comment for {p.name}</label>
                          <input
                            id={`palka-comment-${p.index}`}
                            type="text"
                            className="offloading-comment-input"
                            placeholder="Comment / remark (optional)"
                            value={state.comment ?? ''}
                            onChange={(e) => setPalkaComment(p.index, e.target.value)}
                            maxLength={MAX_REMARK_CHARS}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="offloading-milestone-group">
                  <span className="offloading-milestone-label">Temporary Stop (Cleaning) / Resume</span>
                  <div className="offloading-actions">
                    <button type="button" className="btn btn--secondary" onClick={() => openLogModal('cleaning-temporary-stop', 'Temporary Stop (Cleaning)', true)}>Log now</button>
                    <button type="button" className="btn btn--secondary" onClick={() => openLogModal('cleaning-resume', 'Resume (Cleaning)', true)}>Log now</button>
                  </div>
                </div>
                <div className="offloading-timesheet">
                  <h3 className="offloading-timesheet__title">Timesheet activity</h3>
                  <table className="offloading-timesheet__table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Activity</th>
                        <th>Tag</th>
                        <th>Comment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getTimesheetRowsForStage('C').map((row, i) => (
                        <tr key={`C-${i}`}>
                          <td>{formatTime(row.time)}</td>
                          <td>{row.activityLabel}</td>
                          <td>{row.tagLabel}</td>
                          <td>{row.comment}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Stage D: Line Clearance */}
            {stage === 'D' && (
              <section className="card">
                <h2 className="card__title">Stage D: Line Clearance</h2>
                <div className="offloading-milestone-group">
                  <span className="offloading-milestone-label">Blow Hose</span>
                  <div className="offloading-actions">
                    <button type="button" className="btn btn--primary" onClick={() => openLogModal('blow-hose', 'Blow Hose', false)}>Log now</button>
                    <button type="button" className="btn btn--secondary offloading-log-with-time" onClick={() => openLogModal('blow-hose', 'Blow Hose', false)}>Log with time…</button>
                  </div>
                </div>
                <div className="offloading-milestone-group">
                  <span className="offloading-milestone-label">Vacuum</span>
                  <div className="offloading-actions">
                    <button type="button" className="btn btn--primary" onClick={() => openLogModal('vacuum', 'Vacuum', false)}>Log now</button>
                    <button type="button" className="btn btn--secondary offloading-log-with-time" onClick={() => openLogModal('vacuum', 'Vacuum', false)}>Log with time…</button>
                  </div>
                </div>
                <div className="offloading-milestone-group">
                  <span className="offloading-milestone-label">Final Blow</span>
                  <div className="offloading-actions">
                    <button type="button" className="btn btn--primary" onClick={() => openLogModal('final-blow', 'Final Blow', false)}>Log now</button>
                    <button type="button" className="btn btn--secondary offloading-log-with-time" onClick={() => openLogModal('final-blow', 'Final Blow', false)}>Log with time…</button>
                  </div>
                </div>
                <div className="offloading-timesheet">
                  <h3 className="offloading-timesheet__title">Timesheet activity</h3>
                  <table className="offloading-timesheet__table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Activity</th>
                        <th>Tag</th>
                        <th>Comment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getTimesheetRowsForStage('D').map((row, i) => (
                        <tr key={`D-${i}`}>
                          <td>{formatTime(row.time)}</td>
                          <td>{row.activityLabel}</td>
                          <td>{row.tagLabel}</td>
                          <td>{row.comment}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* Log modal: time + comment; optional tag for Stop/Resume (shared modal classes) */}
      {logModal.open && (
        <div
          className="modal-overlay"
          onClick={() => setLogModal((m) => ({ ...m, open: false }))}
          aria-hidden="true"
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="log-modal-title"
            aria-modal="true"
          >
            <h3 id="log-modal-title" className="modal__title">
              Log: {logModal.label}
            </h3>

            {logModal.requiresTag && (
              <div className="modal__section">
                <label className="modal__label">Reason (required)</label>
                <div className="modal__tags">
                  {OFFLOADING_ACTIVITY_TAGS.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      className={`btn btn--small ${logModal.tagId === tag.id ? 'btn--primary' : 'btn--secondary'} modal__tag`}
                      onClick={() => setLogModal((m) => ({ ...m, tagId: tag.id }))}
                    >
                      {tag.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="modal__section">
              <label htmlFor="log-modal-datetime" className="modal__label">Date & time</label>
              <input
                id="log-modal-datetime"
                type="datetime-local"
                className="modal__input"
                value={logModal.timestamp}
                onChange={(e) => setLogModal((m) => ({ ...m, timestamp: e.target.value }))}
              />
            </div>

            <div className="modal__section">
              <label htmlFor="log-modal-comment" className="modal__label">Comment / remark (optional)</label>
              <textarea
                id="log-modal-comment"
                className="modal__textarea"
                placeholder="Add any comment or remark…"
                value={logModal.comment}
                onChange={(e) => setLogModal((m) => ({ ...m, comment: e.target.value }))}
                maxLength={MAX_REMARK_CHARS}
                rows={3}
              />
            </div>

            <div className="modal__footer">
              <button type="button" className="btn btn--secondary" onClick={() => setLogModal((m) => ({ ...m, open: false }))}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={saveLogModal}
                disabled={logModal.requiresTag && !logModal.tagId}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Palka timestamp edit modal */}
      {palkaTimeEdit && (
        <div
          className="modal-overlay"
          onClick={() => setPalkaTimeEdit(null)}
          aria-hidden="true"
        >
          <div
            className="modal modal--small"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="palka-time-edit-title"
            aria-modal="true"
          >
            <h3 id="palka-time-edit-title" className="modal__title">
              Edit {palkaTimeEdit.action} time — Palka {palkaTimeEdit.palkaIndex}
            </h3>
            <div className="modal__section">
              <label htmlFor="palka-time-edit-datetime" className="modal__label">Date & time</label>
              <input
                id="palka-time-edit-datetime"
                type="datetime-local"
                className="modal__input"
                value={palkaTimeEdit.timestamp}
                onChange={(e) => setPalkaTimeEdit((prev) => prev ? { ...prev, timestamp: e.target.value } : null)}
              />
            </div>
            <div className="modal__footer">
              <button type="button" className="btn btn--secondary" onClick={() => setPalkaTimeEdit(null)}>Cancel</button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => updatePalkaActionTimestamp(palkaTimeEdit.palkaIndex, palkaTimeEdit.action, palkaTimeEdit.timestamp)}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
