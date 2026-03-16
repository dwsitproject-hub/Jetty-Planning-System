/**
 * Departments: in-memory store for RBAC / user management.
 * Admin can manage departments (add, edit, deactivate).
 */

let nextDepartmentId = 1

const departments = [
  { id: 'dept-1', name: 'Industrial - Jetty Operation', code: 'IJO', isActive: true },
  { id: 'dept-2', name: 'Industrial - Quality Control', code: 'IQC', isActive: true },
  { id: 'dept-3', name: 'PPIC', code: 'PPIC', isActive: true },
]
nextDepartmentId = 4

export function getDepartments() {
  return [...departments]
}

export function getActiveDepartments() {
  return departments.filter((d) => d.isActive !== false)
}

export function getDepartmentById(id) {
  return departments.find((d) => d.id === id) ?? null
}

export function addDepartment(data) {
  const id = `dept-${nextDepartmentId++}`
  const entry = {
    id,
    name: (data.name || '').trim() || 'Unnamed',
    code: (data.code || '').trim() || null,
    isActive: data.isActive !== false,
  }
  departments.push(entry)
  return entry
}

export function updateDepartment(id, data) {
  const i = departments.findIndex((d) => d.id === id)
  if (i === -1) return null
  if (data.name !== undefined) departments[i].name = (data.name || '').trim() || departments[i].name
  if (data.code !== undefined) departments[i].code = (data.code || '').trim() || null
  if (data.isActive !== undefined) departments[i].isActive = Boolean(data.isActive)
  return departments[i]
}
