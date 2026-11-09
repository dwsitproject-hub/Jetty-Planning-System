import { useNavigate, useParams } from 'react-router-dom'
import { DESKTOP_QUERY, useMediaQuery } from '../../hooks/useMediaQuery'
import QcSamplingEntry from './QcSamplingEntry'
import QcSamplingQueue from './QcSamplingQueue'
import QcSamplingWorkspace from './QcSamplingWorkspace'

/** Picks the QC layout for `/qc/sampling[/:operationId]`: split workspace on desktop, phone screens below. */
export default function QcSamplingRoute() {
  const { operationId: raw } = useParams()
  const navigate = useNavigate()
  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  const parsed = raw == null ? NaN : Number(raw)
  const operationId = Number.isFinite(parsed) ? parsed : null

  if (isDesktop) return <QcSamplingWorkspace operationId={operationId} />
  if (operationId == null) return <QcSamplingQueue />
  return <QcSamplingEntry key={operationId} operationId={operationId} onBack={() => navigate('/qc/sampling')} />
}
