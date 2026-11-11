import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useRbac } from '../../context/RbacContext'
import QcQueueMessages from './QcQueueMessages'
import QcQueueToolbar from './QcQueueToolbar'
import QcVesselCard from './QcVesselCard'

/**
 * Phone queue for a field menu: one card per vessel call; tapping opens `${basePath}/:operationId`.
 * `queue` comes from `useFieldQueue`; `renderDetail` / `groupBadge` supply the menu's own card content.
 */
export default function FieldQueuePage({ pageKey, basePath, queue, renderDetail, groupBadge }) {
  const navigate = useNavigate()
  const { t } = useTranslation(queue.ns)
  const { loading: rbacLoading, canView } = useRbac()

  if (rbacLoading) return <div className="operator-queue__status">{t('queue.loadingPermissions')}</div>
  if (!canView(pageKey)) {
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
          onOpen={(row) => navigate(`${basePath}/${row.operationId}`)}
          ns={queue.ns}
          statusOf={queue.statusOf}
          renderDetail={renderDetail}
          groupBadge={groupBadge}
        />
      ))}
    </div>
  )
}
