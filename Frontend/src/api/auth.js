import { apiPost, setSelectedPortId } from './client.js'

/** Clear legacy Bearer storage (pre-session-cookie builds). */
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
