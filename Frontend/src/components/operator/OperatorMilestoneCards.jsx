import { useTranslation } from 'react-i18next'
import OperatorCargoSegmentList from './OperatorCargoSegmentList'
import OperatorStateChip from './OperatorStateChip'

export default function OperatorMilestoneCards({
  milestones,
  commodityType,
  canEdit,
  busy,
  onStart,
  onStopCargo,
  onCompleteOther,
  onEditTimestamp,
  onEditCargoSegment,
}) {
  const { t } = useTranslation('operator')

  return (
    <>
      {(milestones || []).map((m) => {
        const isCargo = m.key === 'cargo_operations'
        const isOther = m.key === 'other'
        const title = t(`milestone.${m.key}`, { defaultValue: m.label })
        const cargoSegments = isCargo ? m.cargoSegments || [] : []
        const showStart =
          !isCargo && !isOther
            ? m.state === 'pending'
            : isCargo
              ? m.state !== 'active'
              : m.state === 'pending'
        const showStop = isCargo && m.state === 'active'
        const showComplete = isOther && m.state === 'active'

        return (
          <section key={m.key} className="operator-milestone">
            <div className="operator-milestone__head">
              <h2 className="operator-milestone__title">{title}</h2>
              <OperatorStateChip state={m.state} />
            </div>
            {m.detail && !cargoSegments.length ? (
              <div className="operator-milestone__meta">{m.detail}</div>
            ) : null}
            {isCargo && m.state === 'pending' && commodityType === 'Liquid' ? (
              <div className="operator-milestone__meta">{t('cargo.tanksNoneYet')}</div>
            ) : null}

            {isCargo && cargoSegments.length > 0 ? (
              <OperatorCargoSegmentList
                segments={cargoSegments}
                canEdit={canEdit}
                busy={busy}
                onEditSegment={onEditCargoSegment}
              />
            ) : null}

            <div className={`operator-milestone__actions${isCargo ? ' operator-milestone__actions--split' : ''}`}>
              {showStart ? (
                <button
                  type="button"
                  className="op-btn op-btn--primary"
                  disabled={!canEdit || busy}
                  onClick={() => onStart(m)}
                >
                  {isCargo && m.state === 'done' ? t('action.startNextSegment') : t('action.start')}
                </button>
              ) : null}
              {isCargo ? (
                <button
                  type="button"
                  className="op-btn op-btn--danger"
                  disabled={!canEdit || busy || !showStop}
                  onClick={onStopCargo}
                >
                  {t('action.stop')}
                </button>
              ) : null}
              {showComplete ? (
                <button
                  type="button"
                  className="op-btn op-btn--primary"
                  disabled={!canEdit || busy}
                  onClick={onCompleteOther}
                >
                  {t('action.complete')}
                </button>
              ) : null}
            </div>

            {!isCargo && m.state !== 'pending' && m.activities?.[0] ? (
              <button
                type="button"
                className="op-btn op-btn--soft"
                disabled={!canEdit || busy}
                onClick={() => onEditTimestamp(m)}
              >
                {t('action.editTimestamp')}
              </button>
            ) : null}
          </section>
        )
      })}
    </>
  )
}
