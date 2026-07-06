import { apiPost, getApiOrigin, setSelectedPortId, setMobileAuthToken, ApiError } from './client.js'
import {
  isNative,
  getOnline,
  storeAuthToken,
  removeStoredAuthToken,
  loadStoredAuthToken,
  storeOfflineCredential,
  loadOfflineCredential,
  clearOfflineCredential,
} from '../platform'
import { hashPassword, verifyPassword, isWithinGrace } from '../offline/offlineAuth.js'

/** Clear legacy Bearer storage (pre-session-cookie builds). */
export function clearLegacyToken() {
  try {
    localStorage.removeItem('jps_token')
  } catch {
    /* ignore */
  }
}

/** Offline sign-in grace window (days); configurable at build via env, default 1. */
function offlineGraceDays() {
  try {
    const raw = import.meta?.env?.VITE_OFFLINE_LOGIN_GRACE_DAYS
    const n = Number(raw)
    if (Number.isFinite(n) && n >= 0) return n
  } catch {
    /* ignore */
  }
  return 1
}

export async function login(username, password) {
  // Native + no connection → verify against the cached credential and reuse the
  // stored session. The web always goes to the server.
  if (isNative() && !(await getOnline())) {
    return offlineLogin(username, password)
  }

  const data = await apiPost('/auth/login', { username, password })
  clearLegacyToken()

  if (isNative() && data?.token) {
    setMobileAuthToken(data.token)
    await storeAuthToken(data.token)
    // Cache a hash of the password + the profile so the operator can re-enter
    // offline later. Never store the plaintext password.
    try {
      const cred = await hashPassword(password)
      await storeOfflineCredential({
        username,
        ...cred,
        profile: data.user || null,
        lastOnlineLoginAt: Date.now(),
      })
    } catch {
      /* offline sign-in just won't be available; online login still succeeded */
    }
  }
  return data
}

async function offlineLogin(username, password) {
  const cred = await loadOfflineCredential()
  if (!cred || cred.username !== username) {
    throw new ApiError(0, 'Offline sign-in isn’t set up for this user. Connect once to sign in.')
  }
  if (!isWithinGrace(cred, Date.now(), offlineGraceDays())) {
    throw new ApiError(0, 'Offline sign-in has expired. Please connect to sign in again.')
  }
  const ok = await verifyPassword(password, cred)
  if (!ok) throw new ApiError(401, 'Incorrect username or password.')
  const token = await loadStoredAuthToken()
  if (token) setMobileAuthToken(token)
  return { user: cred.profile, offline: true }
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
    await clearOfflineCredential()
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
