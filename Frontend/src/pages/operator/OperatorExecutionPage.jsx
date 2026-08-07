import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import OperatorActivitySheet from '../../components/operator/OperatorActivitySheet'
import OperatorEditTimestampModal from '../../components/operator/OperatorEditTimestampModal'
import OperatorMilestoneCards from '../../components/operator/OperatorMilestoneCards'
import OperatorPhaseTabs from '../../components/operator/OperatorPhaseTabs'
import OperatorPostCheckingPanel from '../../components/operator/OperatorPostCheckingPanel'
import OperatorSiSwitcher from '../../components/operator/OperatorSiSwitcher'
import OperatorTankPickerSheet from '../../components/operator/OperatorTankPickerSheet'
import PurposeBadge from '../../components/PurposeBadge'
import { useOperatorExecution } from '../../components/operator/useOperatorExecution'
import { useRbac } from '../../context/RbacContext'
import { OPERATOR_PRECHECK_BLOCKED_MSG } from '../../utils/operatorPreCheckingGate'

export default function OperatorExecutionPage() {
  const { operationId: operationIdParam } = useParams()
  const operationId = Number(operationIdParam)
  const navigate = useNavigate()
  const { loading: rbacLoading, canView, canEdit } = useRbac()
  const allowed = canView('operator-at-berth')
  const editable = canEdit('operator-at-berth')

  const exec = useOperatorExecution(Number.isFinite(operationId) ? operationId : null)
  const [phase, setPhase] = useState('operational')
  const [tankPickerOpen, setTankPickerOpen] = useState(false)
  const [editModal, setEditModal] = useState(null)

  const lastCargoTankIds = useMemo(() => {
    const cargo = (exec.milestones || []).find((m) => m.key === 'cargo_operations')
    if (cargo?.openLine?.tankIds?.length) return cargo.openLine.tankIds.map(String)
    if (cargo?.lastTankIds?.length) return cargo.lastTankIds.map(String)
    const acts = cargo?.activities || []
    for (let i = acts.length - 1; i >= 0; i--) {
      const lines = acts[i].cargoLoadLines || []
      const last = lines[lines.length - 1]
      if (last?.tankIds?.length) return last.tankIds.map(String)
      if (acts[i].tankIds?.length) return acts[i].tankIds.map(String)
    }
    return []
  }, [exec.milestones])

  if (rbacLoading || exec.loading) {
    return <div className="operator-queue__status">Loading execution…</div>
  }
  if (!allowed) {
    return (
      <div className="operator-queue">
        <p className="operator-error-banner">You do not have access to Operator Mode.</p>
      </div>
    )
  }
  if (!exec.operation) {
    return (
      <div className="operator-queue">
        <p className="operator-error-banner">{exec.error || 'Operation not found.'}</p>
        <button type="button" className="op-btn" onClick={() => navigate('/operator/at-berth')}>
          Back to queue
        </button>
      </div>
    )
  }

  if (exec.preCheckingComplete === false) {
    return (
      <div className="operator-exec">
        <div className="operator-exec__sticky">
          <header className="operator-exec__header">
            <div className="operator-exec__top">
              <button
                type="button"
                className="op-btn op-btn--soft operator-exec__back"
                onClick={() => navigate('/operator/at-berth')}
                aria-label="Back to queue"
              >
                ←
              </button>
              <div className="operator-exec__identity">
                <h1 className="operator-exec__vessel">{exec.operation.vesselName || 'Vessel'}</h1>
                <p className="operator-exec__purpose">
                  <PurposeBadge purpose={exec.purpose} />
                </p>
              </div>
            </div>
          </header>
        </div>
        <div className="operator-exec__body">
          <p className="operator-error-banner">{OPERATOR_PRECHECK_BLOCKED_MSG}</p>
          <button type="button" className="op-btn op-btn--primary" onClick={() => navigate('/operator/at-berth')}>
            Back to queue
          </button>
        </div>
      </div>
    )
  }

  const handleStart = async (milestone) => {
    if (!editable) return
    if (milestone.key === 'cargo_operations' && exec.commodityType === 'Liquid') {
      setTankPickerOpen(true)
      return
    }
    await exec.startMilestone(milestone.key)
  }

  const handleEditMilestone = (m) => {
    if (!window.confirm('Edit the recorded timestamp?')) return
    const entry = m.activities?.[m.activities.length - 1]
    if (!entry) return
    if (m.key === 'cargo_operations') {
      const lines = entry.cargoLoadLines || []
      const lineIdx = Math.max(
        0,
        lines.findIndex((l) => l.startAt && !l.endAt) >= 0
          ? lines.findIndex((l) => l.startAt && !l.endAt)
          : lines.length - 1
      )
      const line = lines[lineIdx]
      const field = line?.endAt ? 'endAt' : 'startAt'
      const iso = line?.[field] || entry.startTime
      setEditModal({
        kind: 'op',
        entryId: entry.id,
        milestoneKey: m.key,
        field,
        cargoLineIndex: lineIdx,
        initialLocal: exec.toLocal(iso) || exec.nowLocal(),
        title: `Edit ${m.label} timestamp`,
      })
      return
    }
    const field = entry.endTime ? 'endAt' : 'startAt'
    const iso = field === 'endAt' ? entry.endTime : entry.startTime
    setEditModal({
      kind: 'op',
      entryId: entry.id,
      milestoneKey: m.key,
      field,
      initialLocal: exec.toLocal(iso) || exec.nowLocal(),
      title: `Edit ${m.label} timestamp`,
    })
  }

  const handleEditPost = (s) => {
    if (!window.confirm('Edit the recorded timestamp?')) return
    setEditModal({
      kind: 'post',
      apiKey: s.apiKey,
      initialLocal: exec.toLocal(s.occurredAt) || exec.nowLocal(),
      title: `Edit ${s.label} timestamp`,
    })
  }

  return (
    <div className="operator-exec">
      <div className="operator-exec__sticky">
        <header className="operator-exec__header">
          <div className="operator-exec__top">
            <button
              type="button"
              className="op-btn op-btn--soft operator-exec__back"
              onClick={() => navigate('/operator/at-berth')}
              aria-label="Back to queue"
            >
              ←
            </button>
            <div className="operator-exec__identity">
              <h1 className="operator-exec__vessel">{exec.operation.vesselName || 'Vessel'}</h1>
              <p className="operator-exec__purpose">
                <PurposeBadge purpose={exec.purpose} />
              </p>
            </div>
          </div>
          <OperatorSiSwitcher
            siblings={exec.siblings}
            operationId={operationId}
            onChange={(nextId) => navigate(`/operator/execution/${nextId}`)}
          />
        </header>

        <OperatorPhaseTabs phase={phase} onChange={setPhase} />
      </div>

      <div className="operator-exec__body">
        {exec.error ? <p className="operator-error-banner">{exec.error}</p> : null}

        {phase === 'operational' ? (
          <OperatorMilestoneCards
            milestones={exec.milestones}
            commodityType={exec.commodityType}
            canEdit={editable}
            busy={exec.busy}
            onStart={handleStart}
            onStopCargo={exec.stopCargo}
            onCompleteOther={exec.completeOther}
            onEditTimestamp={handleEditMilestone}
          />
        ) : (
          <OperatorPostCheckingPanel
            steps={exec.postSteps}
            canEdit={editable}
            busy={exec.busy}
            onMarkDone={(s) => exec.markPostDone(s.apiKey)}
            onEditTimestamp={handleEditPost}
          />
        )}
      </div>

      <OperatorActivitySheet items={exec.activityLog} />

      <OperatorTankPickerSheet
        open={tankPickerOpen}
        purpose={exec.purpose}
        options={exec.tankOptions}
        initialSelected={lastCargoTankIds}
        busy={exec.busy}
        onCancel={() => setTankPickerOpen(false)}
        onConfirm={async (tankIds) => {
          const ok = await exec.startMilestone('cargo_operations', { tankIds })
          if (ok) setTankPickerOpen(false)
        }}
      />

      <OperatorEditTimestampModal
        open={Boolean(editModal)}
        title={editModal?.title}
        initialLocal={editModal?.initialLocal}
        busy={exec.busy}
        onCancel={() => setEditModal(null)}
        onSave={async (valueLocal) => {
          try {
            if (editModal.kind === 'post') {
              await exec.editPostTimestamp(editModal.apiKey, valueLocal)
            } else {
              await exec.editOperationalTimestamp({
                entryId: editModal.entryId,
                milestoneKey: editModal.milestoneKey,
                field: editModal.field,
                valueLocal,
                cargoLineIndex: editModal.cargoLineIndex,
              })
            }
            setEditModal(null)
          } catch (e) {
            /* toast handled in hook for op; surface here if needed */
            window.alert(e?.message || 'Failed to update timestamp')
          }
        }}
      />

      {exec.toast ? (
        <div
          className={`operator-toast${exec.toast.variant === 'error' ? ' operator-toast--error' : ''}`}
          role="status"
        >
          {exec.toast.message}
        </div>
      ) : null}
    </div>
  )
}
