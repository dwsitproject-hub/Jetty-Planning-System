import { apiPost, getApiOrigin, setSelectedPortId, setMobileAuthToken } from './client.js'
import {
  isNative,
  storeAuthToken,
  removeStoredAuthToken,
  loadStoredAuthToken,
} from '../platform'

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
  // Native app authenticates with a Bearer token (backend returns it in the body when
  // AUTH_RETURN_TOKEN_BODY=true). The web build ignores this and keeps using cookies.
  if (isNative() && data?.token) {
    setMobileAuthToken(data.token)
    await storeAuthToken(data.token)
  }
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
  if (isNative()) {
    setMobileAuthToken(null)
    await removeStoredAuthToken()
  }
}

/**
 * Load a persisted Bearer token into memory at app start (native only) so the API
 * client can authenticate before the first request. No-op on the web.
 */
export async function restoreMobileSession() {
  if (!isNative()) return
  const token = await loadStoredAuthToken()
  if (token) setMobileAuthToken(token)
}

export function getOidcStartUrl() {
  return `${getApiOrigin()}/auth/oidc/start`
}
