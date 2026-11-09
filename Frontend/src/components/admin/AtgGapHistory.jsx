import { useEffect, useState } from 'react'
import { fetchAtgCargoGapHistory } from '../../api/adminOps'
import { formatWhen } from '../../utils/adminOpsDisplay'
import { resyncOutcomeVariant } from '../../utils/atgGapDisplay'

/** Audit trail for one operation: previews, resyncs, acknowledgements, reopens. */
export default function AtgGapHistory({ operationId, refreshKey, t }) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchAtgCargoGapHistory(operationId)
      .then((res) => !cancelled && setItems(res.items ?? []))
      .catch((e) => !cancelled && setError(e?.message || 'Failed to load history'))
    return () => {
      cancelled = true
    }
  }, [operationId, refreshKey])

  if (error) return <p className="admin-ops-error">{error}</p>
  if (!items) return <p className="text-steel">{t('atgGapHistoryLoading')}</p>
  if (!items.length) return <p className="text-steel">{t('atgGapHistoryEmpty')}</p>

  return (
    <ul className="atg-gap-history">
      {items.map((item) => (
        <li key={item.id} className="atg-gap-history__item">
          <span className={`atg-gap-pill atg-gap-pill--${item.outcome ? resyncOutcomeVariant(item.outcome) : 'neutral'}`}>
            {t(`atgGapKind_${item.kind}`, item.kind ?? '')}
          </span>
          <span className="atg-gap-history__summary">{item.summary}</span>
          <span className="text-steel atg-gap-history__meta">
            {item.by ?? '—'} · {formatWhen(item.at)}
          </span>
        </li>
      ))}
    </ul>
  )
}
