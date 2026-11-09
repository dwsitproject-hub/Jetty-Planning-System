import { useEffect, useState } from 'react'
import { fetchTankManualOverrideHistory, setTankManualOverride } from '../../api/tankGauging'
import { formatWhen } from '../../utils/adminOpsDisplay'
import {
  DEFAULT_EXPIRY_DAYS,
  EXPIRY_PRESET_DAYS,
  buildOverrideRequest,
  expiryFromDays,
  isOverrideOn,
} from '../../utils/tankManualOverride'
import '../../styles/modal.css'
import '../../styles/tank-override.css'

function History({ items, t }) {
  if (!items) return <p className="text-steel">{t('tankOverrideHistoryLoading')}</p>
  if (!items.length) return <p className="text-steel">{t('tankOverrideHistoryEmpty')}</p>
  return (
    <ul className="tank-override-history">
      {items.map((h) => (
        <li key={h.id}>
          <strong>{h.enabled ? t('tankOverrideHistoryOn') : t('tankOverrideHistoryOff')}</strong>
          {' · '}
          {h.by ?? '—'} · {formatWhen(h.at)}
          {h.enabled && h.expiresAt ? ` · ${t('tankOverrideUntil', { date: formatWhen(h.expiresAt) })}` : ''}
          {h.reason ? <div className="text-steel">{h.reason}</div> : null}
        </li>
      ))}
    </ul>
  )
}

/**
 * Turn a tank's manual override on or off: switch, reason, auto-off date, history.
 */
export default function TankOverrideDialog({ tank, onClose, onSaved, t }) {
  const wasOn = isOverrideOn(tank)
  const [enabled, setEnabled] = useState(wasOn)
  const [reason, setReason] = useState(wasOn ? tank.manualOverride.reason ?? '' : '')
  const [expiryChoice, setExpiryChoice] = useState(wasOn && !tank.manualOverride.expiresAt ? 'none' : 'days')
  const [days, setDays] = useState(DEFAULT_EXPIRY_DAYS)
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchTankManualOverrideHistory(tank.tankId)
      .then((res) => !cancelled && setHistory(res.items ?? []))
      .catch(() => !cancelled && setHistory([]))
    return () => {
      cancelled = true
    }
  }, [tank.tankId])

  const previewIso = enabled && expiryChoice === 'days' ? expiryFromDays(days) : null

  async function save() {
    const built = buildOverrideRequest({ enabled, reason, expiryChoice, days, date })
    if (!built.ok) {
      setError(built.error === 'reason' ? t('tankOverrideReasonError') : t('tankOverrideDateError'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await setTankManualOverride(tank.tankId, built.body)
      onSaved()
    } catch (e) {
      setError(e?.message === 'reason_required' ? t('tankOverrideReasonError') : e?.message || t('tankOverrideSaveFailed'))
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" role="presentation" onClick={() => !busy && onClose()}>
      <div
        className="modal tank-override-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tank-override-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="tank-override-title" className="modal__title">
          {t('tankOverrideTitle', { code: tank.code })}
        </h2>

        <label className="tank-override-dialog__switch">
          <input type="checkbox" checked={enabled} disabled={busy} onChange={(e) => setEnabled(e.target.checked)} />
          <span>{t('tankOverrideSwitch')}</span>
        </label>

        <label className="modal__label" htmlFor="tank-override-reason">
          {enabled ? t('tankOverrideReasonRequired') : t('tankOverrideReasonOptional')}
        </label>
        <textarea
          id="tank-override-reason"
          className="modal__textarea"
          rows={3}
          value={reason}
          disabled={busy}
          placeholder={t('tankOverrideReasonPlaceholder')}
          onChange={(e) => setReason(e.target.value)}
        />

        {enabled ? (
          <>
            <div className="modal__label">{t('tankOverrideAutoOff')}</div>
            <div className="tank-override-chips">
              {EXPIRY_PRESET_DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`tank-override-chip${expiryChoice === 'days' && days === d ? ' is-active' : ''}`}
                  disabled={busy}
                  onClick={() => {
                    setExpiryChoice('days')
                    setDays(d)
                  }}
                >
                  {t('tankOverrideDays', { count: d })}
                </button>
              ))}
              <button
                type="button"
                className={`tank-override-chip${expiryChoice === 'date' ? ' is-active' : ''}`}
                disabled={busy}
                onClick={() => setExpiryChoice('date')}
              >
                {t('tankOverridePickDate')}
              </button>
              <button
                type="button"
                className={`tank-override-chip${expiryChoice === 'none' ? ' is-active' : ''}`}
                disabled={busy}
                onClick={() => setExpiryChoice('none')}
              >
                {t('tankOverrideNoExpiry')}
              </button>
            </div>
            {expiryChoice === 'date' ? (
              <input type="date" className="modal__input" value={date} disabled={busy} onChange={(e) => setDate(e.target.value)} />
            ) : null}
            {previewIso ? (
              <p className="text-steel tank-override-dialog__hint">{t('tankOverrideTurnsOff', { date: formatWhen(previewIso) })}</p>
            ) : null}
            {expiryChoice === 'none' ? <p className="text-steel tank-override-dialog__hint">{t('tankOverrideNoExpiryWarn')}</p> : null}
            <p className="tank-override-dialog__note">{t('tankOverrideExplain')}</p>
          </>
        ) : null}

        {error ? (
          <p className="admin-ops-error" role="alert">
            {error}
          </p>
        ) : null}

        <h3 className="tank-override-dialog__heading">{t('tankOverrideHistory')}</h3>
        <History items={history} t={t} />

        <div className="modal__footer tank-override-dialog__footer">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            {t('tankOverrideCancel')}
          </button>
          <button type="button" className="btn btn--primary" onClick={save} disabled={busy}>
            {t('tankOverrideSave')}
          </button>
        </div>
      </div>
    </div>
  )
}
