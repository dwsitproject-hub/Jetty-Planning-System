import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchAtgCargoGapJob,
  startAtgCargoGapPreview,
  startAtgCargoGapResync,
  startAtgCargoGapSimulation,
} from '../../api/adminOps'
import { jobErrorKey, waitForJob } from '../../utils/atgGapJob'
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
 * Preview (archive check) → optional simulate → explicit confirmation → run → result.
 * Each server step is a background job the dialog polls, so a slow Tankvision never times out
 * and the dialog can be closed (or reopened later with `resumeJob`) while a job runs.
 */
export default function AtgGapResyncDialog({ operation, gaps, resumeJob = null, onClose, onAcknowledgeRemaining, t }) {
  const initialStep = { preview: 'previewing', resync: 'running' }[resumeJob?.kind] ?? (resumeJob ? 'confirm' : 'previewing')
  const [step, setStep] = useState(initialStep)
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [confirmed, setConfirmed] = useState(false)
  const [sim, setSim] = useState(null)
  const [simulating, setSimulating] = useState(resumeJob?.kind === 'simulate')
  const [simError, setSimError] = useState(null)
  const [progress, setProgress] = useState(null)
  const cancelledRef = useRef(false)
  const startedRef = useRef(false)
  const gapKeys = useMemo(() => gaps.map((g) => g.gapKey), [gaps])
  const operationId = operation.operationId

  const errorText = (e, fallbackKey) => {
    const key = jobErrorKey(e?.message)
    return key ? t(key) : e?.message || t(fallbackKey)
  }

  const handlers = {
    preview: {
      before: () => setStep('previewing'),
      done: (res) => {
        setPreview(res)
        setStep('confirm')
      },
      fail: (e) => {
        setError(errorText(e, 'atgGapPreviewFailed'))
        setStep('confirm')
      },
    },
    simulate: {
      before: () => {
        setSimError(null)
        setSimulating(true)
      },
      done: setSim,
      fail: (e) => setSimError(errorText(e, 'atgGapSimFailed')),
      after: () => setSimulating(false),
    },
    resync: {
      before: () => {
        setError(null)
        setStep('running')
      },
      done: (res) => {
        setResult(res)
        setStep('result')
      },
      fail: (e) => {
        setResult({ outcome: 'failed', error: errorText(e, 'atgGapResyncFailed'), targetGapKeys: gapKeys })
        setStep('result')
      },
    },
  }

  async function execute(kind, startJob) {
    const h = handlers[kind]
    h.before()
    setProgress(null)
    try {
      const { jobId } = await startJob()
      const res = await waitForJob(jobId, {
        fetchJob: fetchAtgCargoGapJob,
        onProgress: setProgress,
        isCancelled: () => cancelledRef.current,
      })
      if (!cancelledRef.current) h.done(res)
    } catch (e) {
      if (!cancelledRef.current) h.fail(e)
    } finally {
      if (!cancelledRef.current) {
        h.after?.()
        setProgress(null)
      }
    }
  }

  useEffect(() => {
    cancelledRef.current = false
    if (!startedRef.current) {
      // Start once per dialog: React dev mode runs effects twice and the server allows one job per operation.
      startedRef.current = true
      const kind = resumeJob?.kind ?? 'preview'
      execute(kind, resumeJob ? async () => ({ jobId: resumeJob.id }) : () => startAtgCargoGapPreview(operationId, gapKeys))
    }
    return () => {
      cancelledRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operationId, gapKeys, resumeJob?.id])

  const previewByGap = useMemo(() => summarizePreviewByGap(preview?.preview), [preview])
  const totalNew = useMemo(
    () => [...previewByGap.values()].reduce((n, r) => n + r.newPoints, 0),
    [previewByGap]
  )
  const busy = step === 'previewing' || step === 'running' || simulating

  const simulate = () => execute('simulate', () => startAtgCargoGapSimulation(operationId, gapKeys))
  const run = () => execute('resync', () => startAtgCargoGapResync(operationId, gapKeys))

  /** Closing while a job runs is fine: it keeps running and the card shows it. */
  function close() {
    onClose(step === 'result' || busy)
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
              <AtgGapProgress message={t('atgGapPreviewLoading', { count: gaps.length })} progress={progress} t={t} />
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
            {simulating ? <AtgGapProgress message={t('atgGapSimulating')} progress={progress} t={t} /> : null}
            {simError ? <p className="admin-ops-error">{simError}</p> : null}
            {sim ? <AtgGapSimulationResult sim={sim} t={t} /> : null}
            <ul className="atg-gap-dialog__notes text-steel">
              <li>{t('atgGapNoteNoOverwrite')}</li>
              <li>{t('atgGapNoteQty')}</li>
              <li>{t('atgGapNoteAudit')}</li>
            </ul>
            {step === 'running' ? <AtgGapProgress message={t('atgGapRunning')} progress={progress} t={t} /> : null}
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
          <button type="button" className="btn btn--ghost" onClick={close}>
            {step === 'result' ? t('atgGapClose') : busy ? t('atgGapCloseBackground') : t('atgGapCancel')}
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
