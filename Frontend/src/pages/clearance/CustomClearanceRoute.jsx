import { useNavigate, useParams } from 'react-router-dom'
import FieldQueuePage from '../../components/qc/FieldQueuePage'
import FieldWorkspace from '../../components/qc/FieldWorkspace'
import ClearanceRowDetail from '../../components/clearance/ClearanceRowDetail'
import { DESKTOP_QUERY, useMediaQuery } from '../../hooks/useMediaQuery'
import { useCustomClearanceQueue } from '../../hooks/useCustomClearanceQueue'
import CustomClearanceEntry from './CustomClearanceEntry'

const PAGE_KEY = 'custom-clearance'
const BASE_PATH = '/clearance/custom'
const renderDetail = (row) => <ClearanceRowDetail row={row} />

function DesktopWorkspace({ operationId }) {
  const queue = useCustomClearanceQueue()
  return (
    <FieldWorkspace
      pageKey={PAGE_KEY}
      basePath={BASE_PATH}
      operationId={operationId}
      queue={queue}
      renderDetail={renderDetail}
      renderEntry={({ operationId: id, clearSelection }) => (
        <CustomClearanceEntry
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

function PhoneQueue() {
  const queue = useCustomClearanceQueue()
  return <FieldQueuePage pageKey={PAGE_KEY} basePath={BASE_PATH} queue={queue} renderDetail={renderDetail} />
}

/** Picks the layout for `/clearance/custom[/:operationId]`: split workspace on desktop, phone screens below. */
export default function CustomClearanceRoute() {
  const { operationId: raw } = useParams()
  const navigate = useNavigate()
  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  const parsed = raw == null ? NaN : Number(raw)
  const operationId = Number.isFinite(parsed) ? parsed : null

  if (isDesktop) return <DesktopWorkspace operationId={operationId} />
  if (operationId == null) return <PhoneQueue />
  return <CustomClearanceEntry key={operationId} operationId={operationId} onBack={() => navigate(BASE_PATH)} />
}
