import { useEffect, useState } from 'react'
import { resolvePreviewSrc } from '../utils/filePreview'

/**
 * Renders an image from an API file URL by fetching with auth headers first.
 * Plain <img src> cannot send X-Selected-Port-Id, which breaks multi-port users.
 */
export default function AuthenticatedFileImage({ url, alt, className, onClick, onKeyDown, role, tabIndex }) {
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!url) {
      setSrc('')
      setFailed(false)
      return undefined
    }
    if (url.startsWith('blob:')) {
      setSrc(url)
      setFailed(false)
      return undefined
    }

    let blobUrl = null
    let cancelled = false
    setFailed(false)
    setSrc('')

    resolvePreviewSrc(url)
      .then((resolved) => {
        if (cancelled) {
          if (resolved.startsWith('blob:') && resolved !== url) URL.revokeObjectURL(resolved)
          return
        }
        if (resolved.startsWith('blob:') && resolved !== url) blobUrl = resolved
        setSrc(resolved)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [url])

  if (failed) {
    return (
      <span className={`authenticated-file-image__fallback ${className || ''}`} title={alt}>
        {alt || 'Image unavailable'}
      </span>
    )
  }

  if (!src) {
    return <span className={`authenticated-file-image__loading text-steel ${className || ''}`}>…</span>
  }

  return (
    <img
      src={src}
      alt={alt || ''}
      className={className}
      onClick={onClick}
      onKeyDown={onKeyDown}
      role={role}
      tabIndex={tabIndex}
    />
  )
}
