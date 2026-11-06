import { useEffect, useMemo, useState } from 'react'
import { previewAtgCargoGapResync, runAtgCargoGapResync, simulateAtgCargoGapResync } from '../../api/adminOps'
import { formatWhen } from '../../utils/adminOpsDisplay'
import {
  formatGapDuration,
  remainingGaps,
  resyncOutcomeVariant,
  summarizePreviewByGap,
} from '../../utils/atgGapDisplay'
import AtgGapProgress from './AtgGapProgress.jsx'
import AtgGapResyncResult from './AtgGapResyncResult.jsx'
import AtgGapSimulationResult from './AtgGapSimulationResult.jsx'
import '../../styles/modal.css'

function PreviewTable({ gaps, previewByGap, t }) {
  return (
    <table className="data-table atg-gap-dialog__table">
      <thead>
        <tr>
          <th>{t('atgGapColWindow')}</th>
          <th>{t('atgGapColTanks')}</th>
          <th className="admin-ops-detail-table__num">{t('atgGapPreviewArchive')}</th>
          <th className="admin-ops-detail-table__num">{t('atgGapPreviewNew')}</th>
        </tr>
      </thead>
      <tbody>
        {gaps.map((g) => {
          const p = previewByGap.get(g.gapKey)
          return (
            <tr key={g.gapKey}>
              <td>
                {formatWhen(g.startAt)} → {formatWhen(g.endAt)}
                <div className="text-steel atg-gap-dialog__sub">{formatGapDuration(g.durationMinutes)}</div>
              </td>
              <td>{(p?.tanks ?? g.tankCodes ?? []).join(', ') || '—'}</td>
              <td className="admin-ops-detail-table__num">{p ? p.archivePoints : '—'}</td>
              <td className="admin-ops-detail-table__num">
                <strong className={p?.newPoints ? 'atg-gap-text--ok' : 'atg-gap-text--warn'}>
                  {p ? p.newPoints : '—'}
                </strong>
                {p?.errors?.length ? <div className="admin-ops-error atg-gap-dialog__sub">{p.errors.join('; ')}</div> : null}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/**
 * Preview (archive dry run) → explicit confirmation → run → result, all in one dialog.
 */
export default function AtgGapResyncDialog({ operation, gaps, onClose, onAcknowledgeRemaining, t }) {
  const [step, setStep] = useState('previewing')
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [confirmed, setConfirmed] = useState(false)
  const [sim, setSim] = useState(null)
  const [simulating, setSimulating] = useState(false)
  const [simError, setSimError] = useState(null)
  const gapKeys = useMemo(() => gaps.map((g) => g.gapKey), [gaps])

  useEffect(() => {
    let cancelled = false
    previewAtgCargoGapResync(operation.operationId, gapKeys)
      .then((res) => {
        if (cancelled) return
        setPreview(res)
        setStep('confirm')
      })
      .catch((e) => {
        if (cancelled) return
        setError(e?.message || t('atgGapPreviewFailed'))
        setStep('confirm')
      })
    return () => {
      cancelled = true
    }
  }, [operation.operationId, gapKeys, t])

  const previewByGap = useMemo(() => summarizePreviewByGap(preview?.preview), [preview])
  const totalNew = useMemo(
    () => [...previewByGap.values()].reduce((n, r) => n + r.newPoints, 0),
    [previewByGap]
  )
  const busy = step === 'previewing' || step === 'running' || simulating

  const errorText = (e, fallbackKey) => (e?.message === 'another_resync_running' ? t('atgGapBusy') : e?.message || t(fallbackKey))

  async function simulate() {
    setSimError(null)
    setSimulating(true)
    try {
      setSim(await simulateAtgCargoGapResync(operation.operationId, gapKeys))
    } catch (e) {
      setSimError(errorText(e, 'atgGapSimFailed'))
    } finally {
      setSimulating(false)
    }
  }

  async function run() {
    setError(null)
    setStep('running')
    try {
      setResult(await runAtgCargoGapResync(operation.operationId, gapKeys))
    } catch (e) {
      setResult({ outcome: 'failed', error: errorText(e, 'atgGapResyncFailed'), targetGapKeys: gapKeys })
    }
    setStep('result')
  }

  function close() {
    if (busy) return
    onClose(step === 'result')
  }

  const remaining = result ? remainingGaps(result) : []

  return (
    <div className="modal-overlay" role="presentation" onClick={close}>
      <div
        className="modal modal--wide atg-gap-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="atg-resync-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="atg-resync-title" className="modal__title">
          {step === 'result' ? t('atgGapResultTitle') : t('atgGapResyncTitle')}
        </h2>
        <p className="text-steel atg-gap-dialog__op">
          {operation.operationLabel || operation.vesselName} · {operation.portName}
        </p>

        {step === 'result' ? (
          <AtgGapResyncResult result={result} variant={resyncOutcomeVariant(result?.outcome)} t={t} />
        ) : (
          <>
            <ol className="atg-gap-dialog__steps">
              <li className="is-done">{t('atgGapStepSelect', { count: gaps.length })}</li>
              <li className={step === 'previewing' ? 'is-active' : 'is-done'}>{t('atgGapStepPreview')}</li>
              <li className={simulating ? 'is-active' : sim ? 'is-done' : ''}>{t('atgGapStepSimulate')}</li>
              <li className={step === 'confirm' || step === 'running' ? 'is-active' : ''}>{t('atgGapStepConfirm')}</li>
            </ol>
            {step === 'previewing' ? (
              <AtgGapProgress message={t('atgGapPreviewLoading', { count: gaps.length })} t={t} />
            ) : (
              <>
                <PreviewTable gaps={gaps} previewByGap={previewByGap} t={t} />
                {preview ? (
                  <p className={`atg-gap-callout atg-gap-callout--${totalNew > 0 ? 'success' : 'warning'}`}>
                    {totalNew > 0 ? t('atgGapPreviewFound', { count: totalNew }) : t('atgGapPreviewNothing')}
                  </p>
                ) : null}
              </>
            )}
            {step === 'confirm' ? (
              <div className="atg-gap-sim__actions">
                <button type="button" className="btn btn--secondary" disabled={busy} onClick={simulate}>
                  {simulating ? t('atgGapSimulatingShort') : sim ? t('atgGapSimulateAgain') : t('atgGapSimulate')}
                </button>
                {simulating ? null : <span className="text-steel atg-gap-dialog__sub">{t('atgGapSimulateHint')}</span>}
              </div>
            ) : null}
            {simulating ? <AtgGapProgress message={t('atgGapSimulating')} t={t} /> : null}
            {simError ? <p className="admin-ops-error">{simError}</p> : null}
            {sim ? <AtgGapSimulationResult sim={sim} t={t} /> : null}
            <ul className="atg-gap-dialog__notes text-steel">
              <li>{t('atgGapNoteNoOverwrite')}</li>
              <li>{t('atgGapNoteQty')}</li>
              <li>{t('atgGapNoteAudit')}</li>
            </ul>
            {step === 'running' ? <AtgGapProgress message={t('atgGapRunning')} t={t} /> : null}
            {error ? <p className="admin-ops-error">{error}</p> : null}
            <label className="atg-gap-dialog__confirm">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>{t('atgGapConfirmCheckbox')}</span>
            </label>
          </>
        )}

        <div className="modal__footer atg-gap-dialog__footer">
          {step === 'result' && remaining.length && result?.outcome !== 'failed' ? (
            <button type="button" className="btn btn--secondary" onClick={() => onAcknowledgeRemaining(remaining.map((g) => g.gapKey))}>
              {t('atgGapAckRemaining', { count: remaining.length })}
            </button>
          ) : null}
          <button type="button" className="btn btn--ghost" onClick={close} disabled={busy}>
            {step === 'result' ? t('atgGapClose') : t('atgGapCancel')}
          </button>
          {step !== 'result' ? (
            <button type="button" className="btn btn--primary" disabled={!confirmed || busy} onClick={run}>
              {step === 'running' ? t('atgGapRunningShort') : t('atgGapRun', { count: gaps.length })}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
