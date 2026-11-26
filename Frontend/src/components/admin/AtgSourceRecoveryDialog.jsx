import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchAtgCargoGapJob, startAtgSourceRecovery } from '../../api/adminOps'
import { jobErrorKey, waitForJob } from '../../utils/atgGapJob'
import {
  entriesByTankCode,
  fromDatetimeLocal,
  toDatetimeLocal,
  validateRecoveryRange,
} from '../../utils/atgSourceRecovery'
import AtgGapProgress from './AtgGapProgress.jsx'
import AtgSourceRecoveryResult from './AtgSourceRecoveryResult.jsx'
import '../../styles/modal.css'

const RANGE_ERROR_KEY = { invalid: 'atgSrcRangeInvalid', order: 'atgSrcRangeOrder', too_long: 'atgSrcRangeTooLong' }

function PreviewTable({ preview, t }) {
  const byTank = useMemo(() => entriesByTankCode(preview.usedBy), [preview])
  return (
    <table className="data-table atg-gap-dialog__table">
      <thead>
        <tr>
          <th>{t('atgSrcColTank')}</th>
          <th className="admin-ops-detail-table__num">{t('atgSrcColArchive')}</th>
          <th className="admin-ops-detail-table__num">{t('atgSrcColNew')}</th>
          <th>{t('atgSrcColUsedBy')}</th>
        </tr>
      </thead>
      <tbody>
        {preview.tanks.map((tank) => (
          <tr key={tank.tankCode}>
            <td>{tank.tankCode}</td>
            <td className="admin-ops-detail-table__num">{tank.archivePoints}</td>
            <td className="admin-ops-detail-table__num">
              <strong className={tank.newPoints ? 'atg-gap-text--ok' : 'atg-gap-text--warn'}>{tank.newPoints}</strong>
              {tank.errors.length ? <div className="admin-ops-error atg-gap-dialog__sub">{tank.errors.join('; ')}</div> : null}
            </td>
            <td>
              {(byTank.get(tank.tankCode) ?? []).map((entry) => (
                <div key={entry.loadLineId}>
                  {t('atgSrcUsedByEntry', {
                    vessel: entry.operationLabel,
                    no: entry.entryNo,
                    mode: t(entry.entryMode === 'manual' ? 'atgSrcModeManual' : 'atgSrcModeAuto'),
                  })}
                </div>
              ))}
              {byTank.has(tank.tankCode) ? null : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * Choose range → preview (archive check) → explicit confirmation → recover → result.
 * Preview and recovery are background jobs the dialog polls, so a slow Tankvision never times out.
 */
export default function AtgSourceRecoveryDialog({ portId, portName, source, initialRange, onClose, t }) {
  const [step, setStep] = useState('range')
  const [from, setFrom] = useState(() => toDatetimeLocal(initialRange.startAt))
  const [to, setTo] = useState(() => toDatetimeLocal(initialRange.endAt))
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [confirmed, setConfirmed] = useState(false)
  const [progress, setProgress] = useState(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  const startAt = fromDatetimeLocal(from)
  const endAt = fromDatetimeLocal(to)
  const rangeProblem = validateRecoveryRange(startAt, endAt)
  const busy = step === 'previewing' || step === 'running'
  const totalNew = preview ? preview.tanks.reduce((n, tank) => n + tank.newPoints, 0) : 0

  const errorText = (e, fallbackKey) => {
    if (e?.message === 'another_resync_running') return t('atgSrcBusy')
    const key = jobErrorKey(e?.message)
    return key ? t(key) : e?.message || t(fallbackKey)
  }

  async function execute(body, { onDone, onFail }) {
    setProgress(null)
    try {
      const { jobId } = await startAtgSourceRecovery({ portId, sourceBaseUrl: source.baseUrl, startAt, endAt, ...body })
      const res = await waitForJob(jobId, {
        fetchJob: fetchAtgCargoGapJob,
        onProgress: setProgress,
        isCancelled: () => cancelledRef.current,
      })
      if (!cancelledRef.current) onDone(res)
    } catch (e) {
      if (!cancelledRef.current) onFail(e)
    } finally {
      if (!cancelledRef.current) setProgress(null)
    }
  }

  function checkArchive() {
    setError(null)
    setConfirmed(false)
    setStep('previewing')
    execute(
      { dryRun: true },
      {
        onDone: (res) => {
          setPreview(res)
          setStep('preview')
        },
        onFail: (e) => {
          setError(errorText(e, 'atgSrcPreviewFailed'))
          setStep('range')
        },
      }
    )
  }

  function recover() {
    setError(null)
    setStep('running')
    execute(
      { confirm: true },
      {
        onDone: (res) => {
          setResult(res)
          setStep('result')
        },
        onFail: (e) => {
          setResult({ error: errorText(e, 'atgSrcResultFailed') })
          setStep('result')
        },
      }
    )
  }

  /** Closing while a job runs is fine: it keeps running and the card shows the result next refresh. */
  const close = () => onClose(step === 'result' || busy)

  return (
    <div className="modal-overlay" role="presentation" onClick={close}>
      <div
        className="modal modal--wide atg-gap-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="atg-src-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="atg-src-title" className="modal__title">{t('atgSrcTitle')}</h2>
        <p className="text-steel atg-gap-dialog__op">{t('atgSrcSubtitle', { source: source.label, port: portName })}</p>

        {step === 'result' ? (
          <AtgSourceRecoveryResult result={result} t={t} />
        ) : (
          <>
            <ol className="atg-gap-dialog__steps">
              <li className={step === 'range' ? 'is-active' : 'is-done'}>{t('atgSrcStepRange')}</li>
              <li className={step === 'previewing' ? 'is-active' : preview ? 'is-done' : ''}>{t('atgSrcStepPreview')}</li>
              <li className={step === 'preview' || step === 'running' ? 'is-active' : ''}>{t('atgSrcStepConfirm')}</li>
            </ol>

            <div className="atg-src__fields">
              <label>
                <span className="text-steel">{t('atgSrcFrom')}</span>
                <input type="datetime-local" className="berthing-modal__input" value={from} disabled={step !== 'range'} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label>
                <span className="text-steel">{t('atgSrcTo')}</span>
                <input type="datetime-local" className="berthing-modal__input" value={to} disabled={step !== 'range'} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
            {step === 'range' ? (
              <p className={`atg-gap-dialog__sub ${rangeProblem ? 'admin-ops-error' : 'text-steel'}`}>
                {rangeProblem ? t(RANGE_ERROR_KEY[rangeProblem]) : t('atgSrcRangeHint')}
              </p>
            ) : null}

            {step === 'previewing' ? <AtgGapProgress message={t('atgSrcPreviewLoading')} progress={progress} keepOpenKey="atgSrcKeepOpen" t={t} /> : null}
            {preview && step !== 'range' && step !== 'previewing' ? (
              <>
                <PreviewTable preview={preview} t={t} />
                <p className={`atg-gap-callout atg-gap-callout--${totalNew > 0 ? 'success' : 'warning'}`}>
                  {totalNew > 0 ? t('atgSrcFound', { count: totalNew }) : t('atgSrcNothing')}
                </p>
                <ul className="atg-gap-dialog__notes text-steel">
                  <li>{t('atgSrcNoteFlag')}</li>
                  <li>{t('atgSrcNoteAtomic')}</li>
                  <li>{t('atgSrcNoteAudit')}</li>
                </ul>
              </>
            ) : null}
            {step === 'running' ? <AtgGapProgress message={t('atgSrcRunning')} progress={progress} keepOpenKey="atgSrcKeepOpen" t={t} /> : null}
            {error ? <p className="admin-ops-error">{error}</p> : null}
            {step === 'preview' || step === 'running' ? (
              <label className="atg-gap-dialog__confirm">
                <input type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} />
                <span>{t('atgSrcConfirmCheckbox')}</span>
              </label>
            ) : null}
          </>
        )}

        <div className="modal__footer atg-gap-dialog__footer">
          {step === 'preview' ? (
            <button type="button" className="btn btn--ghost" onClick={() => setStep('range')}>{t('atgSrcBack')}</button>
          ) : null}
          <button type="button" className="btn btn--ghost" onClick={close}>
            {step === 'result' ? t('atgSrcClose') : busy ? t('atgGapCloseBackground') : t('atgSrcCancel')}
          </button>
          {step === 'range' ? (
            <button type="button" className="btn btn--primary" disabled={Boolean(rangeProblem)} onClick={checkArchive}>
              {t('atgSrcPreviewButton')}
            </button>
          ) : null}
          {step === 'preview' || step === 'running' ? (
            <button type="button" className="btn btn--primary" disabled={!confirmed || busy || totalNew === 0} onClick={recover}>
              {step === 'running' ? t('atgSrcRunningShort') : t('atgSrcRun')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
