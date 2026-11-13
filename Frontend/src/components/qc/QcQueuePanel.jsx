import { useTranslation } from 'react-i18next'
import QcQueueMessages from './QcQueueMessages'
import QcQueueRow from './QcQueueRow'
import QcQueueToolbar from './QcQueueToolbar'

/** Desktop queue pane: toolbar plus compact selectable rows. `queue` comes from `useFieldQueue`. */
export default function QcQueuePanel({ queue, selectedOperationId, onSelect, renderDetail }) {
  const { t } = useTranslation(queue.ns)

  return (
    <div className="qc-queue-panel">
      <div className="qc-queue-panel__head">
        <h1 className="qc-queue-panel__title">{t('queue.title')}</h1>
        <QcQueueToolbar queue={queue} />
      </div>
      <div className="qc-queue-panel__list">
        <QcQueueMessages queue={queue} />
        <ul className="qc-row-list">
          {queue.visible.map((group) => (
            <QcQueueRow
              key={group.key}
              group={group}
              expanded={queue.expanded.has(group.key)}
              onToggle={queue.toggleExpand}
              selectedOperationId={selectedOperationId}
              onSelect={onSelect}
              ns={queue.ns}
              statusOf={queue.statusOf}
              renderDetail={renderDetail}
            />
          ))}
        </ul>
      </div>
    </div>
  )
}
