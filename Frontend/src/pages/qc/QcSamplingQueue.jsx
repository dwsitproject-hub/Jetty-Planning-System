import FieldQueuePage from '../../components/qc/FieldQueuePage'
import QcRowDetail, { qcGroupBadge } from '../../components/qc/QcRowDetail'
import { useQcSamplingQueue } from '../../hooks/useQcSamplingQueue'

const renderDetail = (row) => <QcRowDetail row={row} />

/** Phone queue: one card per vessel call; tapping opens the entry screen. */
export default function QcSamplingQueue() {
  const queue = useQcSamplingQueue()
  return (
    <FieldQueuePage
      pageKey="quality-control"
      basePath="/qc/sampling"
      queue={queue}
      renderDetail={renderDetail}
      groupBadge={qcGroupBadge}
    />
  )
}
