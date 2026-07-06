/**
 * Platform adapter — isolates the few native-vs-web differences so components and
 * the API layer stay generic. On the web every function degrades to a browser API,
 * so the existing web build behaves exactly as before (isNative() === false).
 *
 * Importing @capacitor/* here is safe on the web: Capacitor's core is isomorphic
 * and reports the web platform in a normal browser.
 */
import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { Network } from '@capacitor/network'

export function isNative() {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

export function platformName() {
  try {
    return Capacitor.getPlatform()
  } catch {
    return 'web'
  }
}

/* ---- Secure-ish key/value storage (Preferences on native, localStorage on web/dev) ---- */

export async function secureGet(key) {
  if (isNative()) {
    const { value } = await Preferences.get({ key })
    return value ?? null
  }
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null
  } catch {
    return null
  }
}

export async function secureSet(key, value) {
  if (value == null) return secureRemove(key)
  if (isNative()) {
    await Preferences.set({ key, value: String(value) })
    return
  }
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, String(value))
  } catch {
    /* ignore */
  }
}

export async function secureRemove(key) {
  if (isNative()) {
    await Preferences.remove({ key })
    return
  }
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

/* ---- Auth token persistence (native only; the web app keeps using cookies) ---- */

const AUTH_TOKEN_KEY = 'jps_mobile_at'

export async function loadStoredAuthToken() {
  if (!isNative()) return null
  return secureGet(AUTH_TOKEN_KEY)
}

export async function storeAuthToken(token) {
  if (!isNative()) return
  await secureSet(AUTH_TOKEN_KEY, token)
}

export async function removeStoredAuthToken() {
  if (!isNative()) return
  await secureRemove(AUTH_TOKEN_KEY)
}

/* ---- Network status (Network plugin on native; navigator.onLine on web) ---- */

export async function getOnline() {
  if (isNative()) {
    try {
      const s = await Network.getStatus()
      return s.connected
    } catch {
      return true
    }
  }
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false
}

/**
 * Subscribe to connectivity changes. Returns an unsubscribe function.
 * @param {(online: boolean) => void} cb
 */
export function onNetworkChange(cb) {
  if (isNative()) {
    const handlePromise = Network.addListener('networkStatusChange', (s) => cb(s.connected))
    return () => {
      handlePromise.then((h) => h.remove()).catch(() => {})
    }
  }
  if (typeof window === 'undefined') return () => {}
  const on = () => cb(true)
  const off = () => cb(false)
  window.addEventListener('online', on)
  window.addEventListener('offline', off)
  return () => {
    window.removeEventListener('online', on)
    window.removeEventListener('offline', off)
  }
}
