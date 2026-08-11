import { apiPost, getApiOrigin, setSelectedPortId } from './client.js'
export function clearLegacyToken() {
  try {
    localStorage.removeItem('jps_token')
  } catch {
    /* ignore */
  }
}

export async function login(username, password) {
  const data = await apiPost('/auth/login', { username, password })
  clearLegacyToken()
  return data
}

export async function logout() {
  try {
    await apiPost('/auth/logout', {})
  } catch {
    /* still clear client-side session markers */
  }
  clearLegacyToken()
  setSelectedPortId(null)
}

export function getOidcStartUrl() {
  return `${getApiOrigin()}/auth/oidc/start`
}

/** Public SSO mode flags from backend (no auth required). */
export async function fetchSsoStatus() {
  const res = await fetch(`${getApiOrigin()}/auth/sso/status`, {
    credentials: 'include',
  })
  if (!res.ok) {
    throw new Error('Failed to load SSO status')
  }
  return res.json()
}
