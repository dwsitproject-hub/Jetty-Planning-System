/** Grouping, filtering and sorting for the QC Sampling queue (one card per vessel call). */

export const QC_FILTERS = ['needs', 'done', 'all']
export const QC_SORTS = ['tb', 'vesselName', 'jetty']

function tbMs(row) {
  if (!row?.tbDateTime) return null
  const ms = new Date(row.tbDateTime).getTime()
  return Number.isNaN(ms) ? null : ms
}

function groupKey(row) {
  const pid = Number(row?.shipmentPlanId)
  return Number.isFinite(pid) && pid > 0 ? `p-${pid}` : `o-${row?.operationId}`
}

function groupStatus(children) {
  const statuses = children.map((c) => c.sampling?.status || 'not_started')
  if (statuses.every((s) => s === 'done')) return 'done'
  if (statuses.every((s) => s === 'not_started')) return 'not_started'
  return 'draft'
}

/** Group queue rows by shipment plan so multi-SI vessels become one card with SI rows. */
export function groupQcQueue(rows) {
  const order = []
  const map = new Map()
  for (const row of rows || []) {
    const key = groupKey(row)
    if (!map.has(key)) {
      map.set(key, [])
      order.push(key)
    }
    map.get(key).push(row)
  }
  return order.map((key) => {
    const children = [...map.get(key)].sort((a, b) => a.operationId - b.operationId)
    const head = children[0]
    const times = children.map(tbMs).filter((ms) => ms != null)
    return {
      key,
      children,
      vesselName: head.vesselName || '—',
      jetty: head.jetty || '—',
      tbMs: times.length ? Math.min(...times) : null,
      purposes: [...new Set(children.map((c) => c.purpose).filter(Boolean))],
      siCount: children.length,
      sampledCount: children.filter((c) => c.sampling?.status === 'done').length,
      status: groupStatus(children),
    }
  })
}

export function filterQcGroups(groups, filter, search) {
  const needle = String(search || '').trim().toLowerCase()
  return groups.filter((g) => {
    if (filter === 'needs' && g.status === 'done') return false
    if (filter === 'done' && g.status !== 'done') return false
    if (!needle) return true
    const haystack = [g.vesselName, g.jetty, ...g.children.map((c) => c.shippingInstruction)]
      .join(' ')
      .toLowerCase()
    return haystack.includes(needle)
  })
}

/** `tb` puts the longest-berthed vessel first; vessels without a TB sort last. */
export function sortQcGroups(groups, sortBy) {
  const byName = (a, b) => a.vesselName.localeCompare(b.vesselName)
  return [...groups].sort((a, b) => {
    if (sortBy === 'jetty') return a.jetty.localeCompare(b.jetty) || byName(a, b)
    if (sortBy === 'vesselName') return byName(a, b)
    const ta = a.tbMs ?? Number.MAX_SAFE_INTEGER
    const tb = b.tbMs ?? Number.MAX_SAFE_INTEGER
    return ta - tb || byName(a, b)
  })
}
