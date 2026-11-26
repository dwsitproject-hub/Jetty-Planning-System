import { Link } from 'react-router-dom'

/** Outcome of a source recovery, with the Manual entries that can switch back to ATG. */
export default function AtgSourceRecoveryResult({ result, t }) {
  const manual = result.manualNowRecoverable ?? []
  const failedTanks = result.tanks?.filter((tank) => tank.errors?.length) ?? []

  if (result.error) {
    return <p className="atg-gap-callout atg-gap-callout--error">{result.error}</p>
  }
  if (result.rolledBack) {
    return (
      <>
        <p className="atg-gap-callout atg-gap-callout--warning">
          {t('atgSrcResultRolledBack', { count: failedTanks.length })}
        </p>
        <ul className="atg-gap-dialog__notes text-steel">
          {failedTanks.map((tank) => (
            <li key={tank.tankCode}>
              {tank.tankCode}: {tank.errors.join('; ')}
            </li>
          ))}
        </ul>
      </>
    )
  }
  return (
    <>
      <p className="atg-gap-callout atg-gap-callout--success">
        {t('atgSrcResultOk', { count: result.totals.inserted, tanks: result.totals.tanks })}
      </p>
      {manual.length ? (
        <div className="atg-gap-callout atg-gap-callout--warning">
          <strong>{t('atgSrcManualTitle')}</strong>
          <ul className="atg-src__manual">
            {manual.map((entry) => (
              <li key={entry.loadLineId}>
                {t('atgSrcManualItem', {
                  vessel: entry.operationLabel,
                  no: entry.entryNo,
                  tanks: entry.tankCodes.join(', '),
                })}{' '}
                <Link to={`/loading/operation/${entry.operationId}`} className="link">
                  {t('atgSrcOpenOperation')}
                </Link>
              </li>
            ))}
          </ul>
          <span className="text-steel atg-gap-dialog__sub">{t('atgSrcManualHint')}</span>
        </div>
      ) : null}
    </>
  )
}
