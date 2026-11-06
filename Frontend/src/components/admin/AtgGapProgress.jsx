import { useEffect, useState } from 'react'

function formatElapsed(totalSeconds) {
  const m = Math.floor(totalSeconds / 60)
  const s = String(totalSeconds % 60).padStart(2, '0')
  return `${m}:${s}`
}

/** Indeterminate progress bar with a running timer, so a long server call never looks stuck. */
export default function AtgGapProgress({ message, t }) {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="atg-gap-progress" role="status" aria-live="polite">
      <div className="atg-gap-progress__bar" aria-hidden="true">
        <span />
      </div>
      <p className="atg-gap-progress__text">
        <strong>{message}</strong>
        <span className="text-steel"> · {t('atgGapElapsed', { time: formatElapsed(seconds) })}</span>
      </p>
      <p className="text-steel atg-gap-dialog__sub">{t('atgGapKeepOpen')}</p>
    </div>
  )
}
