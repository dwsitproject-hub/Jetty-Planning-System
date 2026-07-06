/**
 * Offline login credential hashing. Lets the app verify a password on-device
 * (without the server) so operators can sign in with no signal. We store only a
 * PBKDF2 hash + random salt — never the plaintext password. Uses Web Crypto
 * (crypto.subtle), available in the browser, the Android WebView, and Node 18+.
 */
const ITERATIONS = 100000
const KEYLEN_BITS = 256

function toB64(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromB64(str) {
  const bin = atob(str)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i)
  return arr
}

/** Derive a base64 PBKDF2-SHA256 hash for a password + salt. */
export async function deriveHashB64(password, saltBytes, iterations = ITERATIONS) {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(String(password)),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    keyMaterial,
    KEYLEN_BITS
  )
  return toB64(new Uint8Array(bits))
}

/** Hash a password with a fresh random salt → storable credential record. */
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await deriveHashB64(password, salt)
  return { algo: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: toB64(salt), hash }
}

/** Constant-time-ish string compare. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Verify a password against a stored credential record. */
export async function verifyPassword(password, stored) {
  if (!stored || !stored.hash || !stored.salt) return false
  try {
    const h = await deriveHashB64(password, fromB64(stored.salt), stored.iterations || ITERATIONS)
    return safeEqual(h, stored.hash)
  } catch {
    return false
  }
}

/**
 * Whether an offline sign-in is still allowed given the last successful ONLINE
 * login time and the configured grace window (days).
 */
export function isWithinGrace(cred, nowMs, graceDays) {
  if (!cred || !cred.lastOnlineLoginAt) return false
  const graceMs = Math.max(0, Number(graceDays) || 0) * 24 * 60 * 60 * 1000
  return nowMs - cred.lastOnlineLoginAt <= graceMs
}
