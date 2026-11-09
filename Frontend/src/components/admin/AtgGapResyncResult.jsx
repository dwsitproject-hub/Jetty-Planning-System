import { formatWhen } from '../../utils/adminOpsDisplay'
import { formatGapDuration, remainingGaps } from '../../utils/atgGapDisplay'

function Stat({ label, value }) {
  return (
    <div className="atg-gap-stat">
      <span className="atg-gap-stat__value">{value}</span>
      <span className="atg-gap-stat__label">{label}</span>
    </div>
  )
}

/** Persistent outcome of a resync run: what changed and what is still missing. */
export default function AtgGapResyncResult({ result, variant, t }) {
  const outcome = result?.outcome ?? 'failed'
  const stillMissing = remainingGaps(result)
  const targeted = result?.targetTotal ?? result?.targetGapKeys?.length ?? 0
  const closed = result?.targetClosed ?? 0
  const partial = result?.targetPartial ?? 0

  return (
    <div className="atg-gap-result">
      <p className={`atg-gap-callout atg-gap-callout--${variant}`}>
        <strong>{t(`atgGapOutcome_${outcome}`)}</strong>
        <br />
        {t(`atgGapOutcomeHelp_${outcome}`)}
      </p>

      {outcome !== 'failed' ? (
        <div className="atg-gap-stats">
          <Stat label={t('atgGapStatSamples')} value={result.samplesInserted ?? 0} />
          <Stat label={t('atgGapStatHourly')} value={result.hourlyUpserted ?? 0} />
          <Stat label={t('atgGapStatDaily')} value={result.dailyUpserted ?? 0} />
          <Stat label={t('atgGapStatClosed')} value={`${closed} / ${targeted}`} />
          {partial ? <Stat label={t('atgGapStatPartial')} value={partial} /> : null}
        </div>
      ) : (
        <p className="admin-ops-error">{result?.error}</p>
      )}

      {stillMissing.length ? (
        <>
          <h3 className="atg-gap-result__heading">{t('atgGapStillMissing')}</h3>
          <ul className="atg-gap-result__list">
            {stillMissing.map((g) => (
              <li key={g.gapKey}>
                {formatWhen(g.startAt)} → {formatWhen(g.endAt)} ({formatGapDuration(g.durationMinutes)})
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {result?.archiveErrors?.length ? (
        <>
          <h3 className="atg-gap-result__heading">{t('atgGapArchiveErrors')}</h3>
          <ul className="atg-gap-result__list admin-ops-error">
            {result.archiveErrors.map((e, i) => (
              <li key={`${e.tankCode}-${i}`}>
                {e.tankCode}: {e.message}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p className="text-steel atg-gap-dialog__sub">{t('atgGapResultAudit')}</p>
    </div>
  )
}
