import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StickyFormHint, useStickyFormDismiss } from '../StickyFormOverlay.jsx'
import { cleanPalka, PALKA_MAX } from '../../utils/kurasPeriods.js'
import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay.js'

/**
 * Bottom sheet for kuras on another palka (movement type Mixed). Modes:
 *  - start: palka (3 characters at most) and a start time that defaults to now
 *  - stop: end the running kuras now, with an optional quantity cleaned
 *  - stopCargo: cargo is being stopped while kuras still runs: end it with the cargo, or leave it running
 */
export default function OperatorKurasSheet({ sheet, running, palkasUsed, busy, nowLocal, onCancel, onStart, onStop, onEndWithCargo, onKeepRunning }) {
  const { t } = useTranslation('operator')
  const { overlayRef, onBackdropClick, showHint, nudgeClassName } = useStickyFormDismiss()
  const [palka, setPalka] = useState('')
  const [changeTime, setChangeTime] = useState(false)
  const [startLocal, setStartLocal] = useState('')
  const [qty, setQty] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!sheet) return
    setPalka('')
    setChangeTime(false)
    setStartLocal(nowLocal ? nowLocal() : '')
    setQty('')
    setError('')
  }, [sheet, nowLocal])

  if (!sheet) return null
  const mode = sheet.mode
  const now = nowLocal ? nowLocal() : ''

  const submitStart = () => {
    if (!palka) return setError(t('kuras.palkaRequired'))
    return onStart({ palka, startLocal: changeTime ? startLocal : undefined })
  }
  const submitStop = () => {
    if (qty !== '' && !(Number(qty) > 0)) return setError(t('kuras.qtyInvalid'))
    return onStop({ qty: qty === '' ? undefined : Number(qty) })
  }

  return (
    <div ref={overlayRef} className={`operator-modal-backdrop sticky-form-overlay ${nudgeClassName}`.trim()} role="presentation" onClick={onBackdropClick}>
      <StickyFormHint show={showHint} />
      <div className="operator-modal" role="dialog" aria-modal="true" aria-label={t(`kuras.title_${mode}`, { palka: running?.palka })} onClick={(e) => e.stopPropagation()}>
        <div className="operator-modal__title-row">
          <h2>{t(`kuras.title_${mode}`, { palka: running?.palka })}</h2>
          <button type="button" className="modal__close" onClick={onCancel} aria-label={t('close', { ns: 'common' })} disabled={busy}>×</button>
        </div>

        {mode === 'start' ? (
          <>
            <p className="operator-kuras__sub">{t('kuras.pumpingContinues')}</p>
            <div>
              <label htmlFor="operator-kuras-palka">{t('kuras.palkaLabel', { max: PALKA_MAX })}</label>
              <input
                id="operator-kuras-palka"
                className="operator-kuras__palka"
                value={palka}
                maxLength={PALKA_MAX}
                autoComplete="off"
                autoCapitalize="characters"
                onChange={(e) => { setPalka(cleanPalka(e.target.value)); setError('') }}
              />
              {palkasUsed?.length ? (
                <div className="operator-stop-sheet__chips operator-kuras__used">
                  <span className="operator-kuras__sub">{t('kuras.usedBefore')}</span>
                  {palkasUsed.map((p) => (
                    <button key={p} type="button" className={`operator-stop-chip${p === palka ? ' is-active' : ''}`} onClick={() => setPalka(p)}>{p}</button>
                  ))}
                </div>
              ) : null}
            </div>
            {changeTime ? (
              <div>
                <label htmlFor="operator-kuras-start">{t('kuras.startTime')}</label>
                <input id="operator-kuras-start" type="datetime-local" value={startLocal} max={now || undefined} onChange={(e) => setStartLocal(e.target.value)} />
              </div>
            ) : (
              <p className="operator-kuras__sub">
                {t('kuras.startsNow', { time: now ? formatDateTimeDisplay(now) : '' })}{' '}
                <button type="button" className="operator-kuras__link" onClick={() => setChangeTime(true)}>{t('kuras.changeTime')}</button>
              </p>
            )}
            {error ? <p className="operator-error-banner" role="alert">{error}</p> : null}
            <div className="operator-modal__actions">
              <button type="button" className="op-btn op-btn--primary" disabled={busy} onClick={submitStart}>
                {palka ? t('kuras.confirmStart', { palka }) : t('kuras.confirmStartEmpty')}
              </button>
            </div>
          </>
        ) : null}

        {mode === 'stop' ? (
          <>
            <p className="operator-kuras__sub">
              {t('kuras.ranFor', { from: formatDateTimeDisplay(running?.startAt), to: formatDateTimeDisplay(new Date().toISOString()) })}
            </p>
            <div>
              <label htmlFor="operator-kuras-qty">{t('kuras.qtyLabel')}</label>
              <input id="operator-kuras-qty" inputMode="decimal" placeholder={t('kuras.qtyPlaceholder')} value={qty} onChange={(e) => { setQty(e.target.value); setError('') }} />
              <p className="operator-kuras__sub">{t('kuras.qtyHint')}</p>
            </div>
            {error ? <p className="operator-error-banner" role="alert">{error}</p> : null}
            <div className="operator-modal__actions">
              <button type="button" className="op-btn op-btn--primary" disabled={busy} onClick={submitStop}>{t('kuras.confirmStop')}</button>
            </div>
          </>
        ) : null}

        {mode === 'stopCargo' ? (
          <>
            <p className="operator-kuras__sub">{t('kuras.stopCargoBody')}</p>
            <div className="operator-modal__actions operator-stop-sheet__actions">
              <button type="button" className="op-btn op-btn--primary" disabled={busy} onClick={onEndWithCargo}>{t('kuras.endWithCargo')}</button>
              <button type="button" className="op-btn" disabled={busy} onClick={onKeepRunning}>{t('kuras.keepRunning')}</button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
