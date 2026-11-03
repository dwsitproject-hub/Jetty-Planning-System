import { useTranslation } from 'react-i18next'
import { vesselTypeLabel } from '../utils/masterVesselDisplay'

export default function MasterVesselSimilarNotice({ matches, saving, editing, onUse, onAddAnyway }) {
  const { t } = useTranslation('shipmentPlan')
  if (!matches?.length) return null
  const allowAdd = matches.every((match) => match.reason !== 'exact')

  return (
    <div className="master-vessel-form__similar" role="status">
      <p className="master-vessel-form__similar-title">{t('masterVesselSimilarTitle')}</p>
      <ul className="master-vessel-form__similar-list">
        {matches.map((match) => {
          const detail = [vesselTypeLabel(match.vesselType), match.hubCode].filter(Boolean).join(' · ')
          return (
            <li key={match.id} className="master-vessel-form__similar-item">
              <p className="master-vessel-form__similar-name">
                {match.vesselName}
                {detail ? <span className="master-vessel-form__similar-meta"> · {detail}</span> : null}
              </p>
              {match.isActive ? (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => onUse(match)}
                  disabled={saving}
                >
                  {t('masterVesselSimilarUse')}
                </button>
              ) : (
                <p className="master-vessel-form__similar-note">{t('masterVesselSimilarInactive')}</p>
              )}
            </li>
          )
        })}
      </ul>
      {allowAdd ? (
        <button type="button" className="btn btn--secondary" onClick={onAddAnyway} disabled={saving}>
          {editing ? t('masterVesselSimilarSaveAnyway') : t('masterVesselSimilarAddAnyway')}
        </button>
      ) : null}
    </div>
  )
}
