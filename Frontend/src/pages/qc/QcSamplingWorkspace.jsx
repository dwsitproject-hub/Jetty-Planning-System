import FieldWorkspace from '../../components/qc/FieldWorkspace'
import QcRowDetail from '../../components/qc/QcRowDetail'
import { useQcSamplingQueue } from '../../hooks/useQcSamplingQueue'
import QcSamplingEntry from './QcSamplingEntry'

const renderDetail = (row) => <QcRowDetail row={row} />

/** Desktop QC Sampling: queue on the left, sampling entry for the selected vessel on the right. */
export default function QcSamplingWorkspace({ operationId }) {
  const queue = useQcSamplingQueue()
  return (
    <FieldWorkspace
      pageKey="quality-control"
      basePath="/qc/sampling"
      operationId={operationId}
      queue={queue}
      renderDetail={renderDetail}
      renderEntry={({ operationId: id, clearSelection }) => (
        <QcSamplingEntry
          key={id}
          operationId={id}
          embedded
          onBack={clearSelection}
          onSaved={queue.reload}
          onFinalSaved={clearSelection}
        />
      )}
    />
  )
}
