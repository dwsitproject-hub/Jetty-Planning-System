import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  inferMimeType,
  isPreviewableMime,
  resolvePreviewSrc,
  toDownloadUrl,
  toViewUrl,
  triggerFileDownload,
} from '../utils/filePreview'
import '../styles/file-preview.css'

/**
 * @param {{
 *   name?: string,
 *   url: string,
 *   mimeType?: string | null,
 *   onClose: () => void,
 * }} props
 */
export default function FilePreviewModal({ name, url, mimeType, onClose }) {
  const { t } = useTranslation('filePreview')
  const [loadError, setLoadError] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [previewSrc, setPreviewSrc] = useState('')

  const displayName = name || t('untitled')
  const resolvedMime = inferMimeType(displayName, mimeType)
  const previewable = isPreviewableMime(resolvedMime)
  const downloadUrl = toDownloadUrl(url)
  const isImage = resolvedMime?.startsWith('image/')
  const isPdf = resolvedMime === 'application/pdf'

  useEffect(() => {
    let blobToRevoke = null
    let cancelled = false
    setLoadError(false)
    setLoaded(false)
    setPreviewSrc('')

    if (!previewable) return undefined

    resolvePreviewSrc(url)
      .then((src) => {
        if (cancelled) {
          if (src.startsWith('blob:') && src !== url) URL.revokeObjectURL(src)
          return
        }
        if (src.startsWith('blob:') && src !== url) blobToRevoke = src
        setPreviewSrc(src)
      })
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })

    return () => {
      cancelled = true
      if (blobToRevoke) URL.revokeObjectURL(blobToRevoke)
    }
  }, [url, previewable])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleDownload = useCallback(() => {
    triggerFileDownload({ url, filename: displayName })
  }, [url, displayName])

  const handleOpenNewTab = useCallback(() => {
    const viewUrl = toViewUrl(url)
    if (viewUrl) window.open(viewUrl, '_blank', 'noopener,noreferrer')
  }, [url])

  const handleMediaLoad = useCallback(() => {
    setLoaded(true)
    setLoadError(false)
  }, [])

  const handleMediaError = useCallback(() => {
    setLoadError(true)
    setLoaded(false)
  }, [])

  return (
    <div className="modal-overlay file-preview-overlay" onClick={onClose} aria-hidden="true">
      <div
        className="modal modal--file-preview"
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-preview-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="file-preview__header">
          <h2 id="file-preview-title" className="file-preview__title" title={displayName}>
            {displayName}
          </h2>
          <button
            type="button"
            className="file-preview__close-btn"
            onClick={onClose}
            aria-label={t('close')}
          >
            ×
          </button>
        </header>

        <div className="file-preview__body">
          {!previewable ? (
            <div className="file-preview__unsupported">
              <p>{t('unsupportedType')}</p>
            </div>
          ) : loadError ? (
            <div className="file-preview__unsupported">
              <p>{t('loadError')}</p>
            </div>
          ) : !previewSrc ? (
            <p className="file-preview__loading text-steel" role="status">
              {t('loading')}
            </p>
          ) : (
            <>
              {!loaded ? (
                <p className="file-preview__loading text-steel" role="status">
                  {t('loading')}
                </p>
              ) : null}
              {isImage ? (
                <img
                  src={previewSrc}
                  alt={displayName}
                  className="file-preview__image"
                  onLoad={handleMediaLoad}
                  onError={handleMediaError}
                />
              ) : isPdf ? (
                <iframe
                  title={displayName}
                  src={previewSrc}
                  className="file-preview__iframe"
                  onLoad={handleMediaLoad}
                  onError={handleMediaError}
                />
              ) : null}
            </>
          )}
        </div>

        <footer className="file-preview__footer">
          <button type="button" className="btn btn--secondary btn--small" onClick={handleOpenNewTab}>
            {t('openNewTab')}
          </button>
          <button type="button" className="btn btn--secondary btn--small" onClick={handleDownload}>
            {t('download')}
          </button>
        </footer>
      </div>
    </div>
  )
}
