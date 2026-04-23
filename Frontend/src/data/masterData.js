/**
 * Master data: Ports and Jetties. In-memory store with CRUD.
 * Used by Master Port and Master Jetty pages.
 */

let nextPortId = 1
let nextJettyId = 1

const ports = [
  { id: 'p1', name: 'Bontang', description: '' },
  { id: 'p2', name: 'Tanjung Pora', description: '' },
  { id: 'p3', name: 'Lubuk Gaung', description: '' },
]
nextPortId = 4

const jetties = [
  { id: 'j1', portId: 'p1', orderNo: 1, jettyName: '1A', description: '' },
  { id: 'j2', portId: 'p1', orderNo: 2, jettyName: '1B', description: '' },
  { id: 'j3', portId: 'p1', orderNo: 3, jettyName: '2A', description: '' },
  { id: 'j4', portId: 'p1', orderNo: 4, jettyName: '2B', description: '' },
  { id: 'j5', portId: 'p1', orderNo: 5, jettyName: '3A', description: '' },
  { id: 'j6', portId: 'p1', orderNo: 6, jettyName: '3B', description: '' },
]
nextJettyId = 7

export function getPorts() {
  return [...ports]
}

export function getPortById(id) {
  return ports.find((p) => p.id === id) ?? null
}

export function addPort(port) {
  const id = `p${nextPortId++}`
  const entry = { id, name: port.name || '', description: port.description || '' }
  ports.push(entry)
  return entry
}

export function updatePort(id, data) {
  const i = ports.findIndex((p) => p.id === id)
  if (i === -1) return null
  ports[i] = { ...ports[i], ...data }
  return ports[i]
}

export function deletePort(id) {
  const i = ports.findIndex((p) => p.id === id)
  if (i === -1) return false
  ports.splice(i, 1)
  for (let k = jetties.length - 1; k >= 0; k--) {
    if (jetties[k].portId === id) jetties.splice(k, 1)
  }
  return true
}

export function getJetties() {
  return [...jetties]
}

export function getJettiesByPort(portId) {
  return jetties.filter((j) => j.portId === portId).sort((a, b) => a.orderNo - b.orderNo)
}

export function getJettyById(id) {
  return jetties.find((j) => j.id === id) ?? null
}

export function addJetty(jetty) {
  const id = `j${nextJettyId++}`
  const orderNo = Math.max(0, Math.min(32767, parseInt(jetty.orderNo, 10) || 0))
  const entry = {
    id,
    portId: jetty.portId || '',
    orderNo,
    jettyName: jetty.jettyName || '',
    description: jetty.description || '',
  }
  jetties.push(entry)
  return entry
}

export function updateJetty(id, data) {
  const i = jetties.findIndex((j) => j.id === id)
  if (i === -1) return null
  if (data.orderNo !== undefined) {
    data.orderNo = Math.max(0, Math.min(32767, parseInt(data.orderNo, 10) || 0))
  }
  jetties[i] = { ...jetties[i], ...data }
  return jetties[i]
}

export function deleteJetty(id) {
  const i = jetties.findIndex((j) => j.id === id)
  if (i === -1) return false
  jetties.splice(i, 1)
  return true
}

/** Jetty Layout: user-defined schematic layout per port. columns[].top/bottom = { type: 'jetty'|'unused', jettyId? }, middle = { type: 'block'|'unused' } */
const jettyLayoutsByPortId = {}

const defaultBontangLayout = {
  portId: 'p1',
  columns: [
    { top: { type: 'jetty', jettyId: 'j1' }, middle: { type: 'block' }, bottom: { type: 'jetty', jettyId: 'j2' } },
    { top: { type: 'jetty', jettyId: 'j3' }, middle: { type: 'block' }, bottom: { type: 'jetty', jettyId: 'j4' } },
    { top: { type: 'jetty', jettyId: 'j5' }, middle: { type: 'block' }, bottom: { type: 'jetty', jettyId: 'j6' } },
  ],
}

export function getJettyLayout(portId) {
  const saved = jettyLayoutsByPortId[portId]
  if (saved && saved.columns && saved.columns.length > 0) return { ...saved, columns: saved.columns.map((c) => ({ ...c })) }
  if (portId === 'p1') return { ...defaultBontangLayout, columns: defaultBontangLayout.columns.map((c) => ({ ...c })) }
  return null
}

export function setJettyLayout(portId, layout) {
  if (!layout || !Array.isArray(layout.columns)) return
  jettyLayoutsByPortId[portId] = { portId, columns: layout.columns.map((c) => ({ ...c })) }
}

/** Build default layout for a port from its jetties (pairs top/bottom by order, one column per pair). Optional fallback when no layout saved. */
export function buildDefaultJettyLayout(portId) {
  const list = getJettiesByPort(portId)
  if (list.length === 0) return { portId, columns: [] }
  const columns = []
  for (let i = 0; i < list.length; i += 2) {
    const top = list[i]
    const bottom = list[i + 1] || null
    columns.push({
      top: top ? { type: 'jetty', jettyId: top.id } : { type: 'unused' },
      middle: { type: 'block' },
      bottom: bottom ? { type: 'jetty', jettyId: bottom.id } : { type: 'unused' },
    })
  }
  return { portId, columns }
}
