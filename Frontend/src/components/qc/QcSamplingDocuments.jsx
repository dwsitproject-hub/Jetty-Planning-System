import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveUploadUrl } from '../../api/client'
import { useFilePreview } from '../../context/FilePreviewContext'
import { samplingDocumentIsExtractable } from '../../hooks/useSamplingDocumentExtract'

function hrefFor(url) {
  if (!url) return null
  const u = String(url)
  return u.startsWith('blob:') ? u : resolveUploadUrl(u)
}

/** Camera/file upload for the quality report, with per-file Extract, Open and Remove. */
export default function QcSamplingDocuments({ documents, extractingKey, onAddFiles, onRemove, onExtract }) {
  const { t } = useTranslation('qc')
  const { openFilePreview } = useFilePreview()
  const cameraRef = useRef(null)
  const fileRef = useRef(null)
  const [confirmIndex, setConfirmIndex] = useState(null)
  const [error, setError] = useState('')
  const pending = documents.filter((d) => d.file).length

  const pick = (e) => {
    onAddFiles(e.target.files)
    e.target.value = ''
  }

  const remove = async (index) => {
    setError('')
    try {
      await onRemove(index)
    } catch (e) {
      setError(e?.message || t('documents.removeError'))
    } finally {
      setConfirmIndex(null)
    }
  }

  return (
    <section className="qc-card-block" aria-labelledby="qc-docs-title">
      <h2 id="qc-docs-title" className="qc-card-block__title">
        {t('entry.sectionDocuments')}
      </h2>
      <p className="qc-muted">{t('documents.hint')}</p>
      <div className="qc-doc-actions">
        <button type="button" className="op-btn op-btn--soft" onClick={() => cameraRef.current?.click()}>
          {t('documents.takePhoto')}
        </button>
        <button type="button" className="op-btn op-btn--soft" onClick={() => fileRef.current?.click()}>
          {t('documents.chooseFile')}
        </button>
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={fileRef} type="file" accept="image/*,.pdf,.xlsx" multiple hidden onChange={pick} />
      {pending > 0 ? <p className="qc-muted">{t('documents.filesPending', { count: pending })}</p> : null}
      {error ? (
        <p className="operator-error-banner" role="alert">
          {error}
        </p>
      ) : null}
      {documents.length === 0 ? <p className="qc-muted">{t('documents.empty')}</p> : null}
      <ul className="qc-doc-list">
        {documents.map((doc, index) => (
          <li key={doc.id != null ? `doc-${doc.id}` : `local-${index}-${doc.name}`} className="qc-doc">
            <span className="qc-doc__name">{doc.name}</span>
            <div className="qc-doc__actions">
              {samplingDocumentIsExtractable(doc) ? (
                <button
                  type="button"
                  className="op-btn op-btn--soft op-btn--compact"
                  disabled={extractingKey != null}
                  onClick={() => onExtract(doc, index)}
                >
                  {extractingKey === `sampling-${index}` ? t('documents.extracting') : t('documents.extract')}
                </button>
              ) : null}
              {doc.url ? (
                <button
                  type="button"
                  className="op-btn op-btn--soft op-btn--compact"
                  onClick={() =>
                    openFilePreview({ url: hrefFor(doc.url), name: doc.name, mimeType: doc.mimeType ?? null })
                  }
                >
                  {t('documents.open')}
                </button>
              ) : null}
              {confirmIndex === index ? (
                <button type="button" className="op-btn op-btn--danger op-btn--compact" onClick={() => remove(index)}>
                  {t('documents.confirmRemove')}
                </button>
              ) : (
                <button
                  type="button"
                  className="op-btn op-btn--ghost op-btn--compact"
                  onClick={() => (doc.file ? remove(index) : setConfirmIndex(index))}
                >
                  {t('documents.remove')}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
