import { resolveUploadUrl, fetchAuthenticatedBlobUrl } from '../api/client'

const DOWNLOAD_TO_VIEW = [
  [/(\/api\/v1\/si-documents\/\d+)\/download/i, '$1/view'],
  [/(\/api\/v1\/operation-documents\/\d+)\/download/i, '$1/view'],
  [/(\/api\/v1\/sub-process-documents\/\d+)\/download/i, '$1/view'],
]

const API_FILE_URL =
  /\/api\/v1\/(?:(?:si-documents|operation-documents|sub-process-documents)\/\d+\/(?:view|download)|stored-files\/(?:view|download))/i

/** True when the URL targets an authenticated API file endpoint (not static /uploads). */
export function isAuthenticatedApiFileUrl(url) {
  if (!url || url.startsWith('blob:')) return false
  return API_FILE_URL.test(String(url))
}

/** Map a download URL to its inline preview counterpart. Blob and static URLs pass through. */
export function toViewUrl(url) {
  if (url == null || url === '') return ''
  const u = String(url).trim()
  if (u.startsWith('blob:')) return u
  let mapped = u
  for (const [re, repl] of DOWNLOAD_TO_VIEW) {
    if (re.test(mapped)) {
      mapped = mapped.replace(re, repl)
      break
    }
  }
  return resolveUploadUrl(mapped)
}

/** Resolve a file URL for download (attachment endpoints or blob). */
export function toDownloadUrl(url) {
  if (url == null || url === '') return ''
  const u = String(url).trim()
  if (u.startsWith('blob:')) return u
  return resolveUploadUrl(u)
}

/** Infer MIME type from explicit value or filename extension. */
export function inferMimeType(name, mimeType) {
  if (mimeType) return mimeType
  const lower = String(name || '').toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (/\.(jpe?g)$/.test(lower)) return 'image/jpeg'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  return null
}

export function isPreviewableMime(mime) {
  if (!mime) return false
  return mime.startsWith('image/') || mime === 'application/pdf'
}

/**
 * Resolve a displayable src for img/iframe. API files are fetched with auth headers
 * because <img src> cannot send X-Selected-Port-Id (required for multi-port users).
 * @returns {Promise<string>} blob: or direct URL
 */
export async function resolvePreviewSrc(url) {
  if (!url || url.startsWith('blob:')) return url
  const viewUrl = toViewUrl(url)
  if (isAuthenticatedApiFileUrl(viewUrl)) {
    return fetchAuthenticatedBlobUrl(viewUrl)
  }
  return viewUrl
}

/** Trigger a browser download for the given URL. */
export async function triggerFileDownload({ url, filename }) {
  if (!url) return
  let href = url
  let revoke = null
  try {
    if (isAuthenticatedApiFileUrl(toDownloadUrl(url))) {
      href = await fetchAuthenticatedBlobUrl(toDownloadUrl(url))
      revoke = href
    }
  } catch {
    href = toDownloadUrl(url)
  }
  const a = document.createElement('a')
  a.href = href
  if (filename) a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  if (revoke?.startsWith('blob:')) {
    setTimeout(() => URL.revokeObjectURL(revoke), 1000)
  }
}
