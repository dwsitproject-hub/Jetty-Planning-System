/**
 * Merge free-text fields when hydrating subprocess rows from the API.
 * Preserves distinct lines in order; drops duplicate lines so re-fetching
 * or multiple rows with the same remark does not repeat text.
 */
export function mergeDistinctLines(a, b) {
  const parts = []
  for (const chunk of [a, b]) {
    if (chunk == null) continue
    const s = String(chunk).trim()
    if (!s) continue
    for (const line of s.split('\n')) {
      const t = line.trim()
      if (t) parts.push(t)
    }
  }
  const out = []
  const seen = new Set()
  for (const line of parts) {
    if (seen.has(line)) continue
    seen.add(line)
    out.push(line)
  }
  return out.join('\n')
}
