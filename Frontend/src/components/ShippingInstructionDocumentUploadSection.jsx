import { useTranslation } from 'react-i18next'
import { siDocumentDownloadUrl } from '../api/siDocuments'

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
}) {
  const { t } = useTranslation('shippingInstruction')
  const fileInputId = `${idPrefix}si-documents`

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
        onChange={(ev) => {
          ev.stopPropagation()
          onAddFiles(ev)
        }}
        style={{ display: 'block', marginBottom: 'var(--spacing-2)' }}
        aria-label={t('formDocumentUploadAria')}
        disabled={extractBusy}
      />
      {(documents || []).length > 0 ? (
        <ul className="shipping-instruction-docs">
          {(documents || []).map((d) => {
            const href =
              d.downloadUrl ||
              (d.documentId != null ? siDocumentDownloadUrl(d.documentId) : null)
            return (
              <li key={d.id} className="shipping-instruction-docs__item">
                {href ? (
                  <a
                    className="shipping-instruction-docs__name"
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {d.name}
                  </a>
                ) : (
                  <span
                    className="shipping-instruction-docs__name"
                    style={d.failed ? { color: 'var(--color-error, #c62828)' } : undefined}
                  >
                    {d.name}
                    {d.pending ? ` (${t('formDocumentPending')})` : ''}
                    {d.failed ? ` (${t('formDocumentFailed')})` : ''}
                  </span>
                )}
                <button
                  type="button"
                  className="btn btn--secondary btn--small"
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
      ) : (
        <p className="text-steel" style={{ fontSize: 'var(--font-size-small)' }}>
          {t('formNoDocumentsAdded')}
        </p>
      )}
    </div>
  )
}
