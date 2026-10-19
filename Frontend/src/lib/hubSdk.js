/**
 * Downstream Hub analytics SDK (browser only).
 * Off unless both VITE_HUB_SDK_URL and VITE_HUB_SDK_KEY are set at build time.
 * Calls are queued until hub-sdk.js replaces window.DwsHub.
 */

function readViteEnv(name) {
  const env = import.meta.env
  if (!env || typeof env !== 'object') return ''
  const value = env[name]
  return typeof value === 'string' ? value.trim() : ''
}

export function hubSdkEnabled() {
  return Boolean(readViteEnv('VITE_HUB_SDK_URL') && readViteEnv('VITE_HUB_SDK_KEY'))
}

export function hubIdentityPayload(user) {
  const id = typeof user?.id === 'string' ? user.id.trim() : ''
  const email = typeof user?.email === 'string' ? user.email.trim() : ''
  const payload = {}
  if (id) payload.id = id
  if (email) payload.email = email
  return Object.keys(payload).length ? payload : null
}

/** @param {unknown[] | { [method: string]: Function } | null | undefined} hub */
export function enqueueHubCall(hub, method, args = []) {
  const target = hub ?? []
  if (typeof target[method] === 'function') {
    target[method](...args)
    return target
  }
  target.push([method, ...args])
  return target
}

function callHub(method, args) {
  if (!hubSdkEnabled() || typeof window === 'undefined') return
  const hub = (window.DwsHub = window.DwsHub || [])
  enqueueHubCall(hub, method, args)
}

export function identifyHubUser(user) {
  const payload = hubIdentityPayload(user)
  if (!payload) return
  callHub('identify', [payload])
}

export function resetHubUser() {
  callHub('reset', [])
}

export function trackHubPage(path) {
  const page = typeof path === 'string' ? path.trim() : ''
  if (!page) return
  callHub('page', [page])
}

export function openHubBugReport() {
  callHub('openBugReport', [])
}

export function installHubSdk() {
  if (!hubSdkEnabled() || typeof document === 'undefined') return
  if (document.querySelector('script[data-hub-sdk="dws"]')) return
  const script = document.createElement('script')
  script.src = readViteEnv('VITE_HUB_SDK_URL')
  script.defer = true
  script.dataset.hubSdk = 'dws'
  script.dataset.appKey = readViteEnv('VITE_HUB_SDK_KEY')
  script.dataset.bugButton = 'false'
  script.dataset.autoPageViews = 'false'
  const release = readViteEnv('VITE_GIT_SHA')
  if (release) script.dataset.release = release
  if (readViteEnv('VITE_HUB_SDK_DEBUG') === 'true') script.dataset.debug = 'true'
  document.head.appendChild(script)
}
