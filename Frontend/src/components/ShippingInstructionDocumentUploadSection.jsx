import { useTranslation } from 'react-i18next'
import { siDocumentDownloadUrl } from '../api/siDocuments'
import FilePreviewLink from './FilePreviewLink'

/**
 * SI draft document list; upload triggers OCR + storage when parent handles onAddFiles.
 * @param {{
 *   documents: Array<{ id: string, name: string, documentId?: number, downloadUrl?: string }>,
 *   onAddFiles: (e: import('react').ChangeEvent<HTMLInputElement>) => void,
 *   onRemove: (id: string) => void,
 *   idPrefix?: string,
 *   extractBusy?: boolean,
 * }} props
 */
export default function ShippingInstructionDocumentUploadSection({
  documents,
  onAddFiles,
  onRemove,
  idPrefix = '',
  extractBusy = false,
  compact = false,
}) {
  const { t } = useTranslation('shippingInstruction')
  const fileInputId = `${idPrefix}si-documents`

  const handleFiles = (ev) => {
    ev.stopPropagation?.()
    onAddFiles(ev)
  }

  const handleDrop = (ev) => {
    ev.preventDefault()
    ev.stopPropagation()
    if (extractBusy) return
    const files = ev.dataTransfer?.files
    if (!files?.length) return
    onAddFiles({
      preventDefault() {},
      stopPropagation() {},
      target: {
        files,
        value: '',
      },
    })
  }

  const fileRows = (documents || []).length > 0 ? (
    <ul className={`shipping-instruction-docs${compact ? ' shipping-instruction-docs--rows' : ''}`}>
      {(documents || []).map((d) => {
        const href =
          d.downloadUrl ||
          (d.documentId != null ? siDocumentDownloadUrl(d.documentId) : null)
        return (
          <li key={d.id} className="shipping-instruction-docs__item">
            {compact ? <span className="shipping-instruction-docs__chip">SI</span> : null}
            {href ? (
              <FilePreviewLink
                className="shipping-instruction-docs__name file-preview-link"
                url={href}
                name={d.name}
                mimeType={d.mimeType ?? null}
              />
            ) : (
              <span
                className="shipping-instruction-docs__name"
                style={d.failed ? { color: 'var(--color-brand-red)' } : undefined}
              >
                {d.name}
                {d.pending ? ` (${t('formDocumentPending')})` : ''}
                {d.failed ? ` (${t('formDocumentFailed')})` : ''}
              </span>
            )}
            <button
              type="button"
              className={compact ? 'shipping-instruction-docs__remove' : 'btn btn--secondary btn--small'}
              onClick={() => onRemove(d.id)}
              aria-label={t('formDocumentRemoveAria', { name: d.name })}
              disabled={extractBusy}
            >
              {t('formDocumentRemove')}
            </button>
          </li>
        )
      })}
    </ul>
  ) : compact ? null : (
    <p className="text-steel" style={{ fontSize: 'var(--font-size-small)' }}>
      {t('formNoDocumentsAdded')}
    </p>
  )

  if (compact) {
    return (
      <div className="shipment-plan-form__upload">
        <div
          className="shipment-plan-form__dropzone"
          onDragOver={(ev) => {
            ev.preventDefault()
            ev.stopPropagation()
          }}
          onDrop={handleDrop}
        >
          <p>{t('formDropFile')}</p>
          <label className="btn btn--secondary btn--small" htmlFor={fileInputId}>
            {t('formChooseFile')}
          </label>
        </div>
        <input
          id={fileInputId}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.gif,.webp"
          onChange={handleFiles}
          className="shipment-plan-form__file-input"
          aria-label={t('formDocumentUploadAria')}
          disabled={extractBusy}
        />
        {extractBusy ? (
          <p className="text-steel shipment-plan-form__upload-status" role="status">
            {t('formDocumentOcrBusy')}
          </p>
        ) : null}
        {fileRows}
        <details className="shipment-plan-form__upload-help">
          <summary>{t('formHowUploadWorks')}</summary>
          <p>{t('formDocumentUploadHint')}</p>
        </details>
      </div>
    )
  }

  return (
    <div className="shipping-instruction-form__section" style={{ marginBottom: '0.75rem', paddingBottom: '0.75rem' }}>
      <h3 className="shipping-instruction-form__section-title" style={{ fontSize: '1rem' }}>
        {t('formDocumentUpload')}
      </h3>
      <p className="text-steel" style={{ marginBottom: 'var(--spacing-2)', fontSize: 'var(--font-size-small)' }}>
        {t('formDocumentUploadHint')}
      </p>
      {extractBusy ? (
        <p className="text-steel" style={{ marginBottom: 'var(--spacing-2)', fontSize: 'var(--font-size-small)' }} role="status">
          {t('formDocumentOcrBusy')}
        </p>
      ) : null}
      <input
        id={fileInputId}
        type="file"
        multiple
        accept=".pdf,.png,.jpg,.jpeg,.gif,.webp"
        onChange={handleFiles}
        style={{ display: 'block', marginBottom: 'var(--spacing-2)' }}
        aria-label={t('formDocumentUploadAria')}
        disabled={extractBusy}
      />
      {fileRows}
    </div>
  )
}
