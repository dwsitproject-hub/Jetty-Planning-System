/**
 * Restrict jetty dropdown options to the working / selected port.
 * Optionally keep a currently selected jetty from another port so the field is not blank.
 */
export function filterJettiesForPort(jetties, portId, selectedId = null, selectedFallbackName = null) {
  const all = Array.isArray(jetties) ? jetties : []
  const pid = Number(portId)
  const scoped = Number.isFinite(pid) ? all.filter((j) => Number(j.portId) === pid) : []
  if (selectedId == null || selectedId === '') return scoped
  if (scoped.some((j) => String(j.id) === String(selectedId))) return scoped
  const extra = all.find((j) => String(j.id) === String(selectedId))
  if (extra) return [...scoped, { ...extra, otherPort: true }]
  return [
    ...scoped,
    {
      id: selectedId,
      name: selectedFallbackName || String(selectedId),
      portId: null,
      otherPort: true,
    },
  ]
}

export function jettySelectLabel(j, otherPortSuffix = 'other port') {
  const name = j?.name || j?.label || String(j?.id ?? '')
  if (!j?.otherPort) return name
  if (j.portName) return `${name} (${j.portName})`
  return `${name} (${otherPortSuffix})`
}
