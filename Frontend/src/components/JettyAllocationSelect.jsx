import { useTranslation } from 'react-i18next'
import { jettyShortName } from '../utils/jettyAdvice'
import { getAdjacentBerthIds } from '../utils/jettyAdjacency'

/**
 * Multi-jetty berthing: checkbox list of jetties adjacent to the selected primary jetty.
 * Only rendered by the parent when the port's `allow_multi_jetty_berthing` flag is on and a
 * primary jetty is selected.
 */
function AdditionalJettiesPicker({
  adjacentIds,
  selected,
  onChange,
  berthsState,
  jettyAdvice,
  primaryJettyId,
  autoExpand,
  autoExpandHint,
}) {
  const toggle = (shortId, checked) => {
    const next = checked ? [...selected, shortId] : selected.filter((x) => x !== shortId)
    onChange(next)
  }

  if (!adjacentIds.length) {
    return (
      <div className="berthing-modal__jetty-field">
        <p className="berthing-modal__jetty-hint">
          No adjacent jetties configured for {primaryJettyId} (see Master – Jetty).
        </p>
      </div>
    )
  }

  return (
    <div className="berthing-modal__jetty-field berthing-modal__additional-jetties">
      <p className="berthing-modal__label" style={{ marginBottom: '0.25rem' }}>
        Additional jetties (multi-jetty berthing)
      </p>
      {autoExpand && autoExpandHint ? (
        <p className="berthing-modal__jetty-hint berthing-modal__jetty-hint--error" role="alert">
          {autoExpandHint}
        </p>
      ) : null}
      {adjacentIds.map((shortId) => {
        const advice = jettyAdvice?.byShortId?.[shortId]
        const berth = berthsState.find((b) => b.id === shortId)
        const occList = Array.isArray(berth?.occupants)
          ? berth.occupants
          : berth?.currentVesselId
            ? [{ vesselId: berth.currentVesselId }]
            : []
        const cap = berth?.capacity != null ? Number(berth.capacity) : 1
        const safeCap = Number.isFinite(cap) && cap >= 1 ? cap : 1
        // Multi-jetty berthing: a double-bank jetty with one spanned lane (1/2) is NOT fully
        // occupied — only block the additional-jetty checkbox when every bank is taken.
        const occCount =
          berth?.occupiedCount != null
            ? Number(berth.occupiedCount)
            : occList.length +
              (Array.isArray(berth?.spannedByLanes)
                ? berth.spannedByLanes.length
                : berth?.spannedBy
                  ? 1
                  : 0)
        const fullyOccupied = occCount >= safeCap
        const notSuitable = Boolean(jettyAdvice?.adviceReady) && advice && !advice.fits
        const disabled = fullyOccupied || notSuitable
        const checked = selected.includes(shortId)
        let suffix = ''
        if (fullyOccupied) suffix = ' — Occupied'
        else if (occCount > 0) suffix = ` — Occupied (${occCount}/${safeCap})`
        else if (notSuitable) suffix = ' — ✗ not suitable'
        return (
          <label
            key={shortId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '3px 0',
              fontSize: '0.875rem',
              cursor: disabled && !checked ? 'not-allowed' : 'pointer',
              opacity: disabled && !checked ? 0.6 : 1,
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled && !checked}
              onChange={(e) => toggle(shortId, e.target.checked)}
            />
            {shortId}
            {suffix}
          </label>
        )
      })}
    </div>
  )
}

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
  allowMultiJetty = false,
  additionalJetties = [],
  onAdditionalJettiesChange,
  vesselLoaM,
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
      // Multi-jetty berthing: `occupiedCount` also counts a vessel berthed at an adjacent jetty
      // that spans into this one (see backend `buildAllocationOverviewPayload` /
      // `buildBerthsForSchematicDate`) — a plain `occList.length` would miss that and show a
      // spanned-into double-bank jetty as fully vacant.
      const occCount = b?.occupiedCount != null ? Number(b.occupiedCount) : occList.length
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
      {allowMultiJetty && selectedShortId ? (
        <AdditionalJettiesPicker
          adjacentIds={getAdjacentBerthIds(jetties, jettyByShortId[selectedShortId]?.id)}
          selected={additionalJetties}
          onChange={onAdditionalJettiesChange || (() => {})}
          berthsState={berthsState}
          jettyAdvice={jettyAdvice}
          primaryJettyId={selectedShortId}
          autoExpand={
            Number(vesselLoaM) > 0 &&
            jettyByShortId[selectedShortId]?.jettyLengthM != null &&
            Number(vesselLoaM) > Number(jettyByShortId[selectedShortId].jettyLengthM)
          }
          autoExpandHint={`Vessel LOA exceeds Jetty ${selectedShortId} length (${jettyByShortId[selectedShortId]?.jettyLengthM ?? '—'} m) — select adjacent jetty(s) to span.`}
        />
      ) : null}
    </div>
  )
}
