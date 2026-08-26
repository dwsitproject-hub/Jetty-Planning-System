import { useTranslation } from 'react-i18next'
import OperatorStateChip from './OperatorStateChip'

export default function OperatorPostCheckingPanel({ steps, canEdit, busy, onMarkDone, onEditTimestamp }) {
  const { t } = useTranslation('operator')

  return (
    <>
      {(steps || []).map((s) => {
        const title = t(`post.${s.uiKey}`, { defaultValue: s.label })
        return (
          <section key={s.uiKey} className="operator-post-card">
            <div className="operator-milestone__head">
              <h2 className="operator-milestone__title">{title}</h2>
              <OperatorStateChip state={s.state} />
            </div>
            {s.detail ? <div className="operator-milestone__meta">{s.detail}</div> : null}
            {s.state !== 'done' ? (
              <button
                type="button"
                className="op-btn op-btn--primary op-btn--block"
                disabled={!canEdit || busy}
                onClick={() => onMarkDone(s)}
              >
                {t('action.markDone')}
              </button>
            ) : (
              <button
                type="button"
                className="op-btn op-btn--soft"
                disabled={!canEdit || busy}
                onClick={() => onEditTimestamp(s)}
              >
                {t('action.editTimestamp')}
              </button>
            )}
          </section>
        )
      })}
    </>
  )
}
