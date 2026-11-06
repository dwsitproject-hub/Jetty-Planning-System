import { formatWhen } from '../../utils/adminOpsDisplay'
import { formatGapDuration, remainingTargetGapKeys } from '../../utils/atgGapDisplay'

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
  const remainingKeys = new Set(remainingTargetGapKeys(result))
  const remainingGaps = (result?.gapsAfter ?? []).filter((g) => remainingKeys.has(g.gapKey))
  const targeted = result?.targetGapKeys?.length ?? 0

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
          <Stat label={t('atgGapStatClosed')} value={`${targeted - remainingKeys.size} / ${targeted}`} />
        </div>
      ) : (
        <p className="admin-ops-error">{result?.error}</p>
      )}

      {remainingGaps.length ? (
        <>
          <h3 className="atg-gap-result__heading">{t('atgGapStillMissing')}</h3>
          <ul className="atg-gap-result__list">
            {remainingGaps.map((g) => (
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
