import { fetchTankGaugingMassDelta } from '../api/tankGauging'
import { readAtgQtyFromRef } from './atgQty.js'
import { normalizeForApi } from './scheduleDateTime'
export {
  buildLiveCargoProgressSnapshot,
  findOpenCargoLoadLine,
  partitionDraftTanks,
  resolveCargoProgressTotalLoaded,
  resolveDefaultCargoOperationWindowStart,
  resolveOpenLineLiveQty,
  sumClosedPersistedLineQty,
} from './cargoProgressResolvers.js'

export function resolveLineTankIds(line) {
  if (Array.isArray(line?.tankIds) && line.tankIds.length) {
    return line.tankIds.map(String)
  }
  if (Array.isArray(line?.tanks) && line.tanks.length) {
    return line.tanks.map((t) => String(t.id)).filter(Boolean)
  }
  return []
}

function tankHasAtg(tankId, { tankMetaById, tankOptions }) {
  if (tankMetaById?.get(String(tankId))?.hasAtg) return true
  return tankOptions?.find((t) => String(t.id) === String(tankId))?.hasAtg === true
}

/** Derive session UI phase from draft load lines. */
export function deriveCargoSessionPhase(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return 'setup'
  const open = lines.find((l) => l.start && !l.end)
  if (open) return 'in_progress'
  if (lines.some((l) => l.start && l.end)) return 'segment_done'
  return 'setup'
}

/** Segment start = later of operation window start and now (schedule zone). */
export function pickSegmentStartLocal(windowStartLocal, nowLocal, tz) {
  if (!windowStartLocal) return nowLocal
  try {
    const windowMs = new Date(normalizeForApi(windowStartLocal, tz)).getTime()
    const nowMs = new Date(normalizeForApi(nowLocal, tz)).getTime()
    if (Number.isFinite(windowMs) && Number.isFinite(nowMs) && nowMs > windowMs) {
      return nowLocal
    }
  } catch {
    /* fall through */
  }
  return windowStartLocal
}

export function mapExistingCargoLine(l, entry) {
  let tankIds = resolveLineTankIds(l)
  if (tankIds.length === 0 && entry) {
    const lineCount = (entry.cargoLoadLines || []).length
    if (lineCount === 1) {
      tankIds = resolveLineTankIds({ tankIds: entry.tankIds, tanks: entry.tanks })
    }
  }
  return {
    startAt: l.startAt,
    endAt: l.endAt,
    qty: l.qty,
    tankIds,
    atgQtyMode: l.atgQtyMode || 'auto',
    manualQty: l.manualQty,
  }
}

export async function buildStoppedCargoLine(openLine, endIso, { portId, commodityType, tankMetaById, tankOptions, tz, purpose = null, siMetric = 'MT' }) {
  const tankIds = resolveLineTankIds(openLine)
  const line = {
    startAt: openLine.startAt,
    endAt: endIso,
    tankIds,
    atgQtyMode: openLine.atgQtyMode || 'auto',
    manualQty: openLine.manualQty,
  }
  if (commodityType !== 'Liquid' || !portId || tankIds.length === 0) return line

  const atgTankIds = tankIds.filter((id) => tankHasAtg(id, { tankMetaById, tankOptions }))
  if (atgTankIds.length === 0) return line

  const atgQtyMode = openLine.atgQtyMode === 'manual' ? 'manual' : 'auto'
  if (atgQtyMode === 'manual') {
    const mq = Number(openLine.qty ?? openLine.manualQty)
    if (Number.isFinite(mq) && mq > 0) {
      line.qty = mq
      line.atgQtyMode = 'manual'
    }
    return line
  }

  try {
    const startAt =
      typeof openLine.startAt === 'string' && openLine.startAt.includes('T')
        ? openLine.startAt
        : normalizeForApi(openLine.start, tz)
    const data = await fetchTankGaugingMassDelta({
      portId,
      tankIds: atgTankIds,
      startAt,
      endAt: endIso,
      purpose: purpose || undefined,
      siMetric,
    })
    const atgQty = readAtgQtyFromRef(data)
    const manualTankIds = tankIds.filter((id) => !tankHasAtg(id, { tankMetaById, tankOptions }))
    let manualPart = 0
    if (manualTankIds.length > 0) {
      const mq = Number(openLine.manualQty)
      if (Number.isFinite(mq) && mq > 0) manualPart = mq
    }
    if (!data?.incomplete && atgQty != null && atgQty > 0) {
      line.qty = manualPart > 0 ? atgQty + manualPart : atgQty
    } else if (manualPart > 0) {
      line.qty = manualPart
    }
  } catch {
    /* backend may compute ATG on save when qty omitted for pure ATG lines */
  }
  return line
}

export function formatTankStatusList(tankIds, tankMetaById, masterTankOptions) {
  return (tankIds || []).map((id) => {
    const meta = tankMetaById?.get(String(id))
    const opt = masterTankOptions?.find((o) => String(o.value) === String(id))
    const label = meta
      ? meta.name
        ? `${meta.code} — ${meta.name}`
        : meta.code || String(id)
      : opt?.label || String(id)
    return { id: String(id), label, hasAtg: meta?.hasAtg === true }
  })
}

export function getSessionTankIdsFromDraft(lines) {
  const open = (lines || []).find((l) => l.start && !l.end)
  const closed = (lines || []).filter((l) => l.start && l.end)
  const last = closed.length ? closed[closed.length - 1] : null
  const ids = open?.tankIds?.length
    ? open.tankIds
    : last?.tankIds?.length
      ? last.tankIds
      : []
  return Array.isArray(ids) ? ids.map(String) : []
}

export function approxRateTph(movedQty, startIso, endIso) {
  if (!Number.isFinite(movedQty) || movedQty <= 0 || !startIso || !endIso) return null
  const a = new Date(startIso).getTime()
  const b = new Date(endIso).getTime()
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return null
  const hours = (b - a) / 3600000
  if (hours <= 1e-9) return null
  return movedQty / hours
}
