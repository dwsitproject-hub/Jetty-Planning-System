import { useTranslation } from 'react-i18next'

/**
 * Document names list for SI drafts (file content not stored). Used under SI card header for OCR prep.
 * @param {{
 *   documents: Array<{ id: string, name: string }>,
 *   onAddFiles: (e: import('react').ChangeEvent<HTMLInputElement>) => void,
 *   onRemove: (id: string) => void,
 *   idPrefix?: string,
 * }} props
 */
export default function ShippingInstructionDocumentUploadSection({ documents, onAddFiles, onRemove, idPrefix = '' }) {
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
      {/* TODO: OCR — pipe uploads to extraction service and merge into form below */}
      <input
        id={fileInputId}
        type="file"
        multiple
        onChange={onAddFiles}
        style={{ display: 'block', marginBottom: 'var(--spacing-2)' }}
        aria-label={t('formDocumentUploadAria')}
      />
      {(documents || []).length > 0 ? (
        <ul className="shipping-instruction-docs">
          {(documents || []).map((d) => (
            <li key={d.id} className="shipping-instruction-docs__item">
              <span className="shipping-instruction-docs__name">{d.name}</span>
              <button
                type="button"
                className="btn btn--secondary btn--small"
                onClick={() => onRemove(d.id)}
                aria-label={t('formDocumentRemoveAria', { name: d.name })}
              >
                {t('formDocumentRemove')}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-steel" style={{ fontSize: 'var(--font-size-small)' }}>
          {t('formNoDocumentsAdded')}
        </p>
      )}
    </div>
  )
}
