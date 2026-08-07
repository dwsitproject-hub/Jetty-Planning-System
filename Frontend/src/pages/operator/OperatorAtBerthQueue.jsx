import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { fetchAllocationOverview } from '../../api/allocation'
import OperatorCargoProgress from '../../components/operator/OperatorCargoProgress'
import PurposeBadge from '../../components/PurposeBadge'
import { useRbac } from '../../context/RbacContext'
import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay'
import { computeCargoProgress } from '../../utils/cargoQtyDisplay'
import { canOpenOperatorExecution } from '../../utils/operatorPreCheckingGate'
import { evaluatePreCheckingComplete } from '../../utils/loadingHubProcessStagesFromApi'

const SORT_OPTIONS = [
  { value: 'vesselName', labelKey: 'queue.sortVesselName' },
  { value: 'tb', labelKey: 'queue.sortTb' },
  { value: 'jetty', labelKey: 'queue.sortJetty' },
]

function parseDateMs(val) {
  if (!val) return null
  const t = new Date(val).getTime()
  return Number.isNaN(t) ? null : t
}

function purposeDisplay(purposes) {
  if (!purposes.length) return '—'
  if (purposes.length === 1) {
    return <PurposeBadge purpose={purposes[0]} />
  }
  return (
    <span className="operator-queue__purpose-mixed">
      {purposes.map((p) => (
        <PurposeBadge key={p} purpose={p} abbrev />
      ))}
    </span>
  )
}

function getBerthingPlanStatus(row) {
  if (row?.shiftingOut) return 'incoming'
  const hasTb = Boolean(row?.tbDateTime)
  const opStatus = String(row?.status || '').toUpperCase()
  if (
    hasTb ||
    opStatus === 'DOCKED' ||
    opStatus === 'IN_PROGRESS' ||
    opStatus === 'POST_OPS' ||
    opStatus === 'SIGNOFF_REQUESTED' ||
    opStatus === 'SIGNOFF_APPROVED'
  ) {
    return 'berthed'
  }
  return 'incoming'
}

function statusToPhaseKey(status, preCheckingComplete) {
  if (preCheckingComplete === false) return 'preChecking'
  const s = String(status || '')
  if (s === 'IN_PROGRESS') return 'operational'
  if (s === 'POST_OPS') return 'postChecking'
  if (s === 'SIGNOFF_REQUESTED') return 'readyToSail'
  if (s === 'SIGNOFF_APPROVED') return 'signedOff'
  return 'preChecking'
}

function groupKey(row) {
  const pid = Number(row?.shipmentPlanId)
  if (Number.isFinite(pid) && pid > 0) return `p-${pid}`
  return `o-${row?.operationId ?? row?.id ?? 'unknown'}`
}

function siLabel(row) {
  return row.shippingInstruction || row.jettyOperationCode || `Operation ${row.operationId}`
}

function commodityShort(row) {
  return row?.commodityShortDisplay || row?.commodityDisplay || row?.commodity || null
}

/** Operator-facing cargo line: short name + moved/total MT + progress numbers. */
function buildOperatorCargoLine(row) {
  const shortName = commodityShort(row)
  const progress = computeCargoProgress(
    row.totalQtyDisplay,
    row.cargoMovedQty,
    row.cargoFirstLoggedAt,
    row.cargoLastLoggedAt
  )
  if (!shortName && !progress) return null
  return {
    shortName: shortName || '—',
    qtyLine: progress?.cargoLine ?? null,
    done: progress?.done ?? 0,
    total: progress?.qty?.total ?? 0,
    purpose: row.purpose === 'Unloading' ? 'Unloading' : 'Loading',
  }
}

function buildGroups(rows, preCheckMap = {}, t) {
  const order = []
  const map = new Map()
  for (const r of rows) {
    const key = groupKey(r)
    if (!map.has(key)) {
      map.set(key, [])
      order.push(key)
    }
    map.get(key).push(r)
  }
  return order.map((key) => {
    const children = [...map.get(key)].sort(
      (a, b) => (Number(a.operationId) || 0) - (Number(b.operationId) || 0)
    )
    const head = children[0]
    const purposes = [...new Set(children.map((c) => c.purpose).filter(Boolean))]
    const phases = [
      ...new Set(
        children.map((c) =>
          statusToPhaseKey(c.status, preCheckMap[c.operationId ?? c.id])
        )
      ),
    ]
    const tbMs = children.reduce((best, c) => {
      const ms = parseDateMs(c.tbDateTime)
      if (ms == null) return best
      return best == null || ms < best ? ms : best
    }, null)
    return {
      key,
      children,
      vesselName: head.vesselName || '—',
      jetty: head.jetty || '—',
      jettySort: (head.jetty || '').toLowerCase(),
      vesselSort: (head.vesselName || '').toLowerCase(),
      tbMs,
      tbDisplay: formatDateTimeDisplay(tbMs != null ? new Date(tbMs).toISOString() : null),
      purposes,
      purposeNode: purposeDisplay(purposes),
      phaseKey: phases.length === 1 ? phases[0] : phases.length > 1 ? 'mixed' : null,
      phaseLabel:
        phases.length === 1
          ? t(`queue.phase.${phases[0]}`)
          : phases.length > 1
            ? t('queue.phase.mixed')
            : '—',
      cargo: children.length === 1 ? buildOperatorCargoLine(head) : null,
      siCount: children.length,
    }
  })
}

function sortGroups(groups, sortBy) {
  const list = [...groups]
  list.sort((a, b) => {
    if (sortBy === 'tb') {
      const ta = a.tbMs ?? Number.MAX_SAFE_INTEGER
      const tb = b.tbMs ?? Number.MAX_SAFE_INTEGER
      if (ta !== tb) return ta - tb
    } else if (sortBy === 'jetty') {
      const cmp = a.jettySort.localeCompare(b.jettySort)
      if (cmp !== 0) return cmp
    } else {
      const cmp = a.vesselSort.localeCompare(b.vesselSort)
      if (cmp !== 0) return cmp
    }
    return a.vesselSort.localeCompare(b.vesselSort)
  })
  return list
}

export default function OperatorAtBerthQueue() {
  const navigate = useNavigate()
  const { t } = useTranslation('operator')
  const { loading: rbacLoading, canView } = useRbac()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [queue, setQueue] = useState([])
  const [expanded, setExpanded] = useState(() => new Set())
  const [sortBy, setSortBy] = useState('vesselName')
  const [openingId, setOpeningId] = useState(null)
  const [toast, setToast] = useState(null)
  const [preCheckMap, setPreCheckMap] = useState({})

  const showToast = useCallback((message, variant = 'error') => {
    setToast({ message, variant })
    window.setTimeout(() => setToast(null), 4000)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchAllocationOverview()
      const rows = Array.isArray(data?.queue) ? data.queue : []
      setQueue(rows.filter((r) => r.operationId != null && getBerthingPlanStatus(r) === 'berthed'))
    } catch (e) {
      setError(e?.message || t('queue.errorLoad'))
      setQueue([])
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!queue.length) {
      setPreCheckMap({})
      return undefined
    }
    let cancelled = false
    ;(async () => {
      const entries = await Promise.all(
        queue.map(async (row) => {
          const id = row.operationId ?? row.id
          try {
            const complete = await evaluatePreCheckingComplete(id, row.purpose)
            return [id, complete]
          } catch {
            return [id, false]
          }
        })
      )
      if (!cancelled) setPreCheckMap(Object.fromEntries(entries))
    })()
    return () => {
      cancelled = true
    }
  }, [queue])

  const groups = useMemo(
    () => sortGroups(buildGroups(queue, preCheckMap, t), sortBy),
    [queue, preCheckMap, sortBy, t]
  )

  const openOp = async (row) => {
    const operationId = row?.operationId ?? row?.id
    if (operationId == null) return
    setOpeningId(operationId)
    try {
      const gate = await canOpenOperatorExecution(row)
      if (!gate.allowed) {
        showToast(gate.reason || t('precheck.blocked'))
        return
      }
      navigate(`/operator/execution/${operationId}`)
    } finally {
      setOpeningId(null)
    }
  }

  const toggleExpand = (key) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (rbacLoading) {
    return <div className="operator-queue__status">{t('queue.loadingPermissions')}</div>
  }
  if (!canView('operator-at-berth')) {
    return (
      <div className="operator-queue">
        <p className="operator-error-banner">{t('queue.noAccess')}</p>
      </div>
    )
  }

  return (
    <div className="operator-queue">
      <h1 className="operator-queue__title">{t('queue.title')}</h1>
      <p className="operator-queue__sub">{t('queue.sub')}</p>

      {!loading && !error && queue.length > 0 ? (
        <div className="operator-queue__sort">
          <label htmlFor="operator-queue-sort">{t('queue.sortBy')}</label>
          <select
            id="operator-queue-sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {loading ? <p className="operator-queue__status">{t('queue.loading')}</p> : null}
      {error ? <p className="operator-error-banner">{error}</p> : null}
      {!loading && !error && groups.length === 0 ? (
        <p className="operator-queue__status">{t('queue.noVessels')}</p>
      ) : null}

      {groups.map((g) => {
        const isMulti = g.siCount > 1
        const isOpen = expanded.has(g.key)
        return (
          <article key={g.key} className="operator-vessel-card">
            <div
              className="operator-vessel-card__main"
              role="button"
              tabIndex={0}
              onClick={() => {
                if (isMulti) toggleExpand(g.key)
                else openOp(g.children[0])
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  if (isMulti) toggleExpand(g.key)
                  else openOp(g.children[0])
                }
              }}
            >
              <div className="operator-vessel-card__name">{g.vesselName}</div>
              <div className="operator-vessel-card__meta">
                <span className="operator-vessel-card__purpose">{g.purposeNode}</span>
                <span>{g.jetty}</span>
                {g.tbDisplay && g.tbDisplay !== '—' ? (
                  <>
                    <span>·</span>
                    <span>{t('queue.tbPrefix')} {g.tbDisplay}</span>
                  </>
                ) : null}
              </div>
              <div className="operator-vessel-card__row">
                <span>
                  {g.phaseLabel}
                  {isMulti ? ` · ${t('queue.instructionsCount', { count: g.siCount })}` : ''}
                </span>
              </div>
              {!isMulti && g.cargo ? (
                <div className="operator-vessel-card__cargo">
                  <OperatorCargoProgress
                    shortName={g.cargo.shortName}
                    qtyLine={g.cargo.qtyLine}
                    done={g.cargo.done}
                    total={g.cargo.total}
                    purpose={g.cargo.purpose}
                  />
                </div>
              ) : null}
            </div>

            {isMulti ? (
              <>
                <button
                  type="button"
                  className="operator-vessel-card__si-toggle"
                  onClick={() => toggleExpand(g.key)}
                >
                  {isOpen ? t('queue.hideSi') : t('queue.chooseSi')}
                </button>
                {isOpen ? (
                  <div className="operator-vessel-card__children">
                    {g.children.map((child) => {
                      const childCargo = buildOperatorCargoLine(child)
                      return (
                        <button
                          key={child.operationId}
                          type="button"
                          className="operator-vessel-card__child"
                          onClick={() => openOp(child)}
                          disabled={openingId != null}
                        >
                          <span className="operator-vessel-card__child-body">
                            <span className="operator-vessel-card__child-main">
                              <PurposeBadge purpose={child.purpose} loadDischarge={child.loadDischarge} abbrev />
                              <span>{siLabel(child)}</span>
                            </span>
                            {childCargo ? (
                              <span className="operator-vessel-card__child-cargo">
                                <OperatorCargoProgress
                                  shortName={childCargo.shortName}
                                  qtyLine={childCargo.qtyLine}
                                  done={childCargo.done}
                                  total={childCargo.total}
                                  purpose={childCargo.purpose}
                                />
                              </span>
                            ) : null}
                          </span>
                          <span>{t('queue.open')}</span>
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </>
            ) : null}
          </article>
        )
      })}

      {toast ? (
        <div
          className={`operator-toast${toast.variant === 'error' ? ' operator-toast--error' : ''}`}
          role="status"
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  )
}
