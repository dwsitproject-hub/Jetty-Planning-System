import { useTranslation } from 'react-i18next'
import { jettyShortName } from '../utils/jettyAdvice'

/**
 * Jetty select with preferred-jetty advice: filtered options, suitability suffixes, and suggestion hint.
 * Used in Allocation modals (Log arrival update, Confirm Berthing).
 */
export default function JettyAllocationSelect({
  id,
  value,
  onChange,
  required = false,
  berthIds = [],
  berthsState = [],
  jetties = [],
  jettyAdvice,
  showOccupancyLabels = false,
  placeholder = '—',
  className = 'berthing-modal__input',
  labelClassName = 'berthing-modal__label',
  label,
  ariaDescribedBy,
}) {
  const { t } = useTranslation('shipmentPlan')
  const adviceReady = jettyAdvice?.adviceReady ?? false
  const hasConfiguredSpecs = jettyAdvice?.hasConfiguredSpecs ?? false
  const hasLoa = jettyAdvice?.hasLoa ?? false
  const hasEta = jettyAdvice?.hasEta ?? false
  const selectedShortId = (value || '').trim()

  const jettyByShortId = {}
  for (const j of jetties) {
    const shortId = jettyShortName(j.name)
    if (shortId) jettyByShortId[shortId] = j
  }

  const optionShortIds = berthIds.length
    ? berthIds
    : jetties.map((j) => jettyShortName(j.name)).filter(Boolean)

  const filteredShortIds = optionShortIds.filter((shortId) => {
    const a = jettyAdvice?.byShortId?.[shortId]
    if (!adviceReady || !a || a.fits) return true
    return shortId === selectedShortId
  })

  const buildOptionLabel = (shortId) => {
    const a = jettyAdvice?.byShortId?.[shortId]
    let label = shortId

    if (showOccupancyLabels) {
      const b = berthsState.find((bb) => bb.id === shortId)
      const cap = b?.capacity != null ? Number(b.capacity) : 1
      const occList = Array.isArray(b?.occupants)
        ? b.occupants
        : b?.currentVesselId
          ? [{ vesselId: b.currentVesselId }]
          : []
      const occCount = occList.length
      label =
        occCount > 0
          ? `${shortId} – Occupied (${occCount}/${Math.max(1, cap)})`
          : `${shortId} – Vacant (0/${Math.max(1, cap)})`
    }

    if (adviceReady && a) {
      if (!a.fits) label += ` — ✗ ${t('jettyNotSuitable')}`
      else if (a.occupied) label += ` — ${t('jettyOccupiedAtEta')}`
      else if (a.hasSpecs) label += ' — ✓'
    }

    return label
  }

  const suggestedNames = (jettyAdvice?.suggested || [])
    .map((j) => jettyShortName(j.name) || j.name)
    .filter(Boolean)

  let hintMessage = null
  let hintIsError = false
  if (!hasLoa) {
    hintMessage = t('jettyAdviceNeedLoa', {
      defaultValue: 'Set vessel LOA on the shipment plan to enable jetty suggestions.',
    })
    hintIsError = true
  } else if (!hasEta) {
    hintMessage = t('jettyAdviceNeedEta', {
      defaultValue: 'Set ETA to enable jetty suggestions.',
    })
    hintIsError = true
  } else if (!hasConfiguredSpecs) {
    hintMessage = t('jettyAdviceNeedMasterSpecs', {
      defaultValue:
        'Configure jetty length, DWT, and commodities in Master – Preferred Jetty to enable suggestions.',
    })
    hintIsError = true
  } else if (adviceReady) {
    if (suggestedNames.length > 0) {
      hintMessage = t('jettySuggestionLabel', { list: suggestedNames.join(', ') })
      hintIsError = false
    } else {
      hintMessage = t('jettyNoSuggestion')
      hintIsError = true
    }
  }

  return (
    <div className="berthing-modal__jetty-field">
      {label ? (
        <label htmlFor={id} className={labelClassName}>
          {label}
          {required ? <span className="required-star"> *</span> : null}
        </label>
      ) : null}
      <select
        id={id}
        className={className}
        value={value || ''}
        onChange={onChange}
        aria-describedby={ariaDescribedBy}
        aria-required={required || undefined}
      >
        <option value="">{placeholder}</option>
        {filteredShortIds.map((shortId) => (
          <option key={shortId} value={shortId}>
            {buildOptionLabel(shortId)}
          </option>
        ))}
      </select>
      {hintMessage ? (
        <p
          className={`berthing-modal__jetty-hint${hintIsError ? ' berthing-modal__jetty-hint--error' : ''}`}
          role={hintIsError ? 'alert' : 'status'}
        >
          {hintMessage}
        </p>
      ) : null}
    </div>
  )
}
