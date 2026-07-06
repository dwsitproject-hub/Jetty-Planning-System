/**
 * Serialize/deserialize multipart FormData so file uploads (e.g. NOR documents,
 * vessel photos) can be queued in the outbox while offline and replayed later.
 * Files are stored as base64 in the (IndexedDB) outbox; on replay the FormData is
 * reconstructed. Uses Blob/File/FormData + base64, available in the browser, the
 * Android WebView, and Node 20+ (so the round-trip is unit-testable).
 */

function bytesToB64(bytes) {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(s)
}

function b64ToBytes(b64) {
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i)
  return arr
}

function isBlobLike(v) {
  return v && typeof v === 'object' && typeof v.arrayBuffer === 'function'
}

/**
 * @param {FormData} formData
 * @returns {Promise<{__form:true, parts:Array}>}
 */
export async function serializeFormData(formData) {
  const parts = []
  for (const [name, value] of formData.entries()) {
    if (isBlobLike(value)) {
      const bytes = new Uint8Array(await value.arrayBuffer())
      parts.push({
        name,
        kind: 'file',
        filename: value.name || 'file',
        type: value.type || 'application/octet-stream',
        data: bytesToB64(bytes),
      })
    } else {
      parts.push({ name, kind: 'text', value: String(value) })
    }
  }
  return { __form: true, parts }
}

/**
 * @param {{parts:Array}} serialized
 * @returns {FormData}
 */
export function deserializeToFormData(serialized) {
  const fd = new FormData()
  for (const p of serialized?.parts || []) {
    if (p.kind === 'file') {
      const blob = new Blob([b64ToBytes(p.data)], { type: p.type || 'application/octet-stream' })
      try {
        fd.append(p.name, new File([blob], p.filename, { type: p.type }))
      } catch {
        fd.append(p.name, blob, p.filename)
      }
    } else {
      fd.append(p.name, p.value)
    }
  }
  return fd
}

export function isSerializedForm(body) {
  return Boolean(body && typeof body === 'object' && body.__form === true)
}
