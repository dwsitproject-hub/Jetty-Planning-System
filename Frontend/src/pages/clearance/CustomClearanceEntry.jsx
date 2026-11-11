import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import PurposeBadge from '../../components/PurposeBadge'
import QcEntryBanners from '../../components/qc/QcEntryBanners'
import QcSamplingDocuments from '../../components/qc/QcSamplingDocuments'
import QcSaveBar from '../../components/qc/QcSaveBar'
import QcStatusChip from '../../components/qc/QcStatusChip'
import { useRbac } from '../../context/RbacContext'
import { useCustomClearanceEntry } from '../../hooks/useCustomClearanceEntry'
import { clearanceEntryStatus } from '../../utils/customClearance'
import '../../styles/custom-clearance.css'

const NS = 'customClearance'
const REMARK_MAX = 500

/** One field with its label always shown above the input, so the field stays named while typing. */
function LabeledField({ id, label, required = false, error, children }) {
  const { t } = useTranslation(NS)
  return (
    <div className={`qc-field cc-field${error ? ' qc-field--error' : ''}`}>
      <label className="qc-field__label cc-field__label" htmlFor={id}>
        {label}
        {required ? <span className="cc-field__required" aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {error ? <span className="qc-field__error">{t(`error.${error}`)}</span> : null}
    </div>
  )
}

/**
 * Custom Clearance entry for one operation. Used full-screen on phones and inside the desktop workspace.
 *
 * @param {object} props
 * @param {number} props.operationId
 * @param {() => void} props.onBack leave the entry (phone: back to the queue; desktop: clear selection)
 * @param {(mode: 'draft'|'final') => void} [props.onSaved] called after any successful save
 * @param {() => void} [props.onFinalSaved] called after a final save; defaults to `onBack`
 * @param {boolean} [props.embedded] desktop pane: hides the back button
 */
export default function CustomClearanceEntry({ operationId, onBack, onSaved, onFinalSaved, embedded = false }) {
  const { t } = useTranslation(NS)
  const { loading: rbacLoading, canView } = useRbac()
  const entry = useCustomClearanceEntry(operationId)
  const [message, setMessage] = useState(null)
  const [errors, setErrors] = useState({})
  const { form, header } = entry

  if (rbacLoading || entry.loading) return <div className="operator-queue__status">{t('entry.loading')}</div>
  if (!canView('custom-clearance')) {
    return (
      <div className="operator-queue">
        <p className="operator-error-banner">{t('entry.noAccess')}</p>
      </div>
    )
  }
  if (entry.error || !header) {
    return (
      <div className="operator-queue qc-entry">
        <p className="operator-error-banner" role="alert">
          {entry.status === 404 ? t('entry.notFound') : entry.error || t('entry.loadFailed')}
        </p>
        <button type="button" className="op-btn op-btn--soft" onClick={onBack}>
          {t('entry.back')}
        </button>
      </div>
    )
  }

  const change = (field, value) => {
    entry.setField(field, value)
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  const handleSave = async (mode, options) => {
    setMessage(null)
    setErrors({})
    const out = await entry.save(mode, options)
    if (out.conflict) return undefined
    if (out.errors) {
      setErrors(out.errors)
      return setMessage({ type: 'error', text: t('save.fixErrors') })
    }
    if (!out.ok) return setMessage({ type: 'error', text: out.message || t('save.error') })
    onSaved?.(mode)
    if (mode === 'final') return (onFinalSaved ?? onBack)()
    setMessage({ type: 'success', text: t('save.successDraft') })
    return undefined
  }

  const addFiles = (files) => {
    entry.addFiles(files)
    if (errors.documents) setErrors((prev) => ({ ...prev, documents: undefined }))
  }

  return (
    <div className={`qc-entry${embedded ? ' qc-entry--embedded' : ''}`}>
      <div className="qc-entry__scroll">
        <header className="qc-entry__header">
          {embedded ? null : (
            <button type="button" className="op-btn op-btn--soft op-btn--compact" onClick={onBack}>
              ‹ {t('entry.back')}
            </button>
          )}
          <div className="qc-entry__title-row">
            <div className="qc-entry__identity">
              <h1 className="qc-entry__vessel">{header.vesselName}</h1>
              <PurposeBadge purpose={header.purpose} loadDischarge={header.loadDischarge} />
            </div>
            <QcStatusChip status={clearanceEntryStatus(form)} ns={NS} />
          </div>
          <p className="qc-entry__meta">
            {[header.shippingInstruction, header.commodityShortDisplay || header.commodityDisplay, header.jetty]
              .filter((v) => v && v !== '-')
              .join(' · ')}
          </p>
        </header>

        <QcEntryBanners
          entry={entry}
          message={message}
          ns={NS}
          onOverwrite={(mode) => handleSave(mode, { force: true })}
        />

        <div className="qc-entry__body cc-entry__body">
          <section className="qc-card-block" aria-labelledby="cc-time-title">
            <h2 id="cc-time-title" className="qc-card-block__title">
              {t('entry.sectionTime')}
            </h2>
            <div className="qc-field-grid">
              <LabeledField id="cc-start-time" label={t('entry.startTime')} required error={errors.startTime}>
                <input
                  id="cc-start-time"
                  type="datetime-local"
                  className="qc-input"
                  value={form.startTime}
                  aria-invalid={errors.startTime ? 'true' : undefined}
                  onChange={(e) => change('startTime', e.target.value)}
                />
              </LabeledField>
              <LabeledField id="cc-end-time" label={t('entry.endTime')} required error={errors.endTime}>
                <input
                  id="cc-end-time"
                  type="datetime-local"
                  className="qc-input"
                  value={form.endTime}
                  min={form.startTime || undefined}
                  aria-invalid={errors.endTime ? 'true' : undefined}
                  onChange={(e) => change('endTime', e.target.value)}
                />
              </LabeledField>
            </div>
            <LabeledField id="cc-remark" label={t('entry.remark')}>
              <textarea
                id="cc-remark"
                className="qc-input qc-input--area"
                rows={3}
                maxLength={REMARK_MAX}
                value={form.remark}
                onChange={(e) => change('remark', e.target.value)}
              />
            </LabeledField>
          </section>

          <div className={errors.documents ? 'cc-docs cc-docs--error' : 'cc-docs'}>
            <QcSamplingDocuments
              ns={NS}
              keyPrefix="custom-clearance"
              documents={form.documents}
              onAddFiles={addFiles}
              onRemove={entry.removeDocument}
            />
            {errors.documents ? (
              <p className="qc-field__error cc-docs__error" role="alert">
                {t(`error.documents.${errors.documents}`)}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <QcSaveBar
        ns={NS}
        saving={entry.saving}
        dirty={entry.dirty}
        lastSavedAt={form.lastSavedAt}
        onSave={handleSave}
      />
    </div>
  )
}
