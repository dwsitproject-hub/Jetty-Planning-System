import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import QcQueueMessages from '../../components/qc/QcQueueMessages'
import QcQueueToolbar from '../../components/qc/QcQueueToolbar'
import QcVesselCard from '../../components/qc/QcVesselCard'
import { useRbac } from '../../context/RbacContext'
import { useQcSamplingQueue } from '../../hooks/useQcSamplingQueue'

/** Phone queue: one card per vessel call; tapping opens the entry screen. */
export default function QcSamplingQueue() {
  const navigate = useNavigate()
  const { t } = useTranslation('qc')
  const { loading: rbacLoading, canView } = useRbac()
  const queue = useQcSamplingQueue()

  if (rbacLoading) return <div className="operator-queue__status">{t('queue.loadingPermissions')}</div>
  if (!canView('quality-control')) {
    return (
      <div className="operator-queue">
        <p className="operator-error-banner">{t('queue.noAccess')}</p>
      </div>
    )
  }

  return (
    <div className="operator-queue qc-queue">
      <h1 className="operator-queue__title">{t('queue.title')}</h1>
      <p className="operator-queue__sub">{t('queue.sub')}</p>

      <QcQueueToolbar queue={queue} />
      <QcQueueMessages queue={queue} />

      {queue.visible.map((group) => (
        <QcVesselCard
          key={group.key}
          group={group}
          expanded={queue.expanded.has(group.key)}
          onToggle={queue.toggleExpand}
          onOpen={(row) => navigate(`/qc/sampling/${row.operationId}`)}
        />
      ))}
    </div>
  )
}
