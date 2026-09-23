/** True when the page is loaded inside an allocation pipeline iframe (?embed=1). */
export function isEmbedMode(search) {
  const raw = typeof search === 'string' ? search : search?.toString?.() ?? ''
  return new URLSearchParams(raw).get('embed') === '1'
}

/** Append ?embed=1 (or &embed=1) when embed mode is active. */
export function withEmbedParam(path, search) {
  if (!path || path === '#' || !isEmbedMode(search)) return path
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}embed=1`
}

/** Routes that render without the main Layout shell when ?embed=1. */
export function isPipelineEmbedPath(pathname) {
  return (
    /^\/(loading|unloading)(\/|$)/.test(pathname) ||
    pathname === '/verification' ||
    pathname.startsWith('/verification/')
  )
}
