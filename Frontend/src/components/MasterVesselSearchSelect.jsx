import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { fetchMasterVessels, fetchMasterVesselById, fetchSimilarMasterVessels } from '../api/masterVessels'
import AppToast from './AppToast.jsx'
import MasterVesselFormModal, { EMPTY_VESSEL_FORM, pushSaveToast } from './MasterVesselFormModal.jsx'
import { useRbac } from '../context/RbacContext'
import { formatMasterVesselLabel, masterVesselToSelectOption, vesselTypeLabel } from '../utils/masterVesselDisplay'

const MIN_SEARCH_CHARS = 2
const SEARCH_DEBOUNCE_MS = 300

/**
 * Async master-vessel picker with debounced server search (for large fleets).
 * @param {Object} props
 * @param {string} [props.id]
 * @param {string} props.value - selected master vessel id
 * @param {(value: string) => void} props.onChange
 * @param {(vessel: Record<string, unknown>) => void} [props.onVesselSelect]
 * @param {string} [props.placeholder]
 * @param {string} [props.initialLabel] - fallback label while loading selected vessel
 * @param {boolean} [props.disabled]
 * @param {string} [props.className]
 */
export default function MasterVesselSearchSelect({
  id,
  value,
  onChange,
  onVesselSelect,
  placeholder,
  initialLabel = '',
  disabled = false,
  className = '',
}) {
  const { t } = useTranslation('shipmentPlan')
  const { canEdit } = useRbac()
  const canAddVessel = canEdit('master-vessel')
  const [open, setOpen] = useState(false)
  const [createName, setCreateName] = useState(null)
  const [toast, setToast] = useState(null)
  const [filter, setFilter] = useState('')
  const [options, setOptions] = useState([])
  const [similarOptions, setSimilarOptions] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedVessel, setSelectedVessel] = useState(null)
  const [panelStyle, setPanelStyle] = useState(null)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const searchInputRef = useRef(null)
  const searchSeqRef = useRef(0)
  const debounceRef = useRef(null)

  const resolvedPlaceholder = placeholder ?? t('masterVesselSearchPlaceholder')

  useEffect(() => {
    if (!value) {
      setSelectedVessel(null)
      return
    }
    let cancelled = false
    fetchMasterVesselById(value)
      .then((row) => {
        if (!cancelled && row) setSelectedVessel(row)
      })
      .catch(() => {
        if (!cancelled) setSelectedVessel(null)
      })
    return () => {
      cancelled = true
    }
  }, [value])

  const selectedLabel = useMemo(() => {
    if (selectedVessel && String(selectedVessel.id) === String(value)) {
      return formatMasterVesselLabel(selectedVessel)
    }
    if (initialLabel && value) return initialLabel
    if (value) return value
    return resolvedPlaceholder
  }, [selectedVessel, value, initialLabel, resolvedPlaceholder])

  const updatePanelPosition = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const maxH = Math.min(280, Math.max(120, window.innerHeight - r.bottom - 12))
    setPanelStyle({
      position: 'fixed',
      top: r.bottom + 4,
      left: r.left,
      width: Math.max(r.width, 220),
      maxHeight: maxH,
      zIndex: 1100,
    })
  }, [])

  useLayoutEffect(() => {
    if (!open) {
      setPanelStyle(null)
      return
    }
    updatePanelPosition()
    window.addEventListener('scroll', updatePanelPosition, true)
    window.addEventListener('resize', updatePanelPosition)
    return () => {
      window.removeEventListener('scroll', updatePanelPosition, true)
      window.removeEventListener('resize', updatePanelPosition)
    }
  }, [open, updatePanelPosition])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 5500)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e) => {
      if (triggerRef.current?.contains(e.target)) return
      if (panelRef.current?.contains(e.target)) return
      setOpen(false)
      setFilter('')
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setFilter('')
      }
    }
    document.addEventListener('mousedown', onDocMouseDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (open && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const q = filter.trim()
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.length < MIN_SEARCH_CHARS) {
      setLoading(false)
      setSimilarOptions([])
      return
    }
    debounceRef.current = setTimeout(() => {
      const seq = ++searchSeqRef.current
      setLoading(true)
      Promise.all([
        fetchMasterVessels({ search: q, activeOnly: true }),
        fetchSimilarMasterVessels({ name: q, activeOnly: true }).catch(() => []),
      ])
        .then(([rows, similarRows]) => {
          if (seq !== searchSeqRef.current) return
          const list = Array.isArray(rows) ? rows : []
          const exact = list.map(masterVesselToSelectOption)
          const exactIds = new Set(exact.map((opt) => opt.value))
          const similar = (Array.isArray(similarRows) ? similarRows : [])
            .filter((row) => row?.id != null && row.isActive !== false && !exactIds.has(String(row.id)))
            .map((row) => {
              const type = vesselTypeLabel(row.vesselType)
              const base = formatMasterVesselLabel(row)
              return {
                value: String(row.id),
                label: type ? `${base} · ${type}` : base,
                vessel: row,
              }
            })
          setOptions(exact)
          setSimilarOptions(similar)
        })
        .catch(() => {
          if (seq !== searchSeqRef.current) return
          setOptions([])
          setSimilarOptions([])
        })
        .finally(() => {
          if (seq === searchSeqRef.current) setLoading(false)
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [filter, open])

  const handleSelect = (opt) => {
    onChange(opt.value)
    if (opt.vessel) {
      setSelectedVessel(opt.vessel)
      onVesselSelect?.(opt.vessel)
    }
    setOpen(false)
    setFilter('')
    setOptions([])
    setSimilarOptions([])
  }

  const openCreate = () => {
    const name = filter.trim()
    setOpen(false)
    setFilter('')
    setOptions([])
    setSimilarOptions([])
    setCreateName(name)
  }

  const handleSimilarSelect = async (opt) => {
    let vessel = opt.vessel
    try {
      const full = await fetchMasterVesselById(opt.value)
      if (full) vessel = full
    } catch {
      vessel = opt.vessel
    }
    handleSelect({ ...opt, vessel })
  }

  const toggleOpen = () => {
    if (disabled) return
    setOpen((o) => {
      if (!o) {
        setFilter('')
        setOptions([])
        setSimilarOptions([])
      }
      return !o
    })
  }

  const qTrim = filter.trim()
  const showMinCharsHint = open && qTrim.length < MIN_SEARCH_CHARS
  const showEmpty = open && qTrim.length >= MIN_SEARCH_CHARS && !loading && options.length === 0 && similarOptions.length === 0

  const portalContent =
    open &&
    panelStyle &&
    createPortal(
      <div
        ref={panelRef}
        className="searchable-select__portal-root"
        style={panelStyle}
        role="listbox"
        aria-labelledby={id ? `${id}-label` : undefined}
      >
        <div className="searchable-select__search-wrap">
          <input
            ref={searchInputRef}
            type="search"
            className="searchable-select__search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('masterVesselSearchPlaceholder')}
            aria-label={t('masterVesselSearchPlaceholder')}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
        <ul className="searchable-select__list">
          {showMinCharsHint ? (
            <li className="searchable-select__empty">{t('masterVesselSearchMinChars')}</li>
          ) : loading && options.length === 0 && similarOptions.length === 0 ? (
            <li className="searchable-select__empty">{t('masterVesselSearchLoading')}</li>
          ) : showEmpty ? (
            <li className="searchable-select__empty">{t('masterVesselSearchEmpty')}</li>
          ) : (
            <>
              {options.map((opt) => (
                <li key={opt.value} role="option" aria-selected={opt.value === value}>
                  <button
                    type="button"
                    className={`searchable-select__option${opt.value === value ? ' searchable-select__option--selected' : ''}`}
                    onClick={() => handleSelect(opt)}
                  >
                    {opt.label}
                  </button>
                </li>
              ))}
              {similarOptions.length > 0 ? (
                <li className="searchable-select__group" role="presentation">{t('masterVesselSimilarNames')}</li>
              ) : null}
              {similarOptions.map((opt) => (
                <li key={`similar-${opt.value}`} role="option" aria-selected={opt.value === value}>
                  <button
                    type="button"
                    className={`searchable-select__option${opt.value === value ? ' searchable-select__option--selected' : ''}`}
                    onClick={() => handleSimilarSelect(opt)}
                  >
                    {opt.label}
                  </button>
                </li>
              ))}
            </>
          )}
          {loading && (options.length > 0 || similarOptions.length > 0) ? (
            <li className="searchable-select__empty">{t('masterVesselSearchLoading')}</li>
          ) : null}
        </ul>
        {canAddVessel && qTrim.length >= MIN_SEARCH_CHARS ? (
          <div className="searchable-select__footer">
            <button type="button" className="searchable-select__add" onClick={openCreate}>
              {t('masterVesselAddFromSearch', { name: qTrim })}
            </button>
          </div>
        ) : null}
      </div>,
      document.body
    )

  return (
    <div className={`searchable-select ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className="dropdown-multi__trigger searchable-select__trigger"
        onClick={toggleOpen}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="dropdown-multi__trigger-text">{selectedLabel}</span>
        <span className="dropdown-multi__chevron" aria-hidden>
          ▼
        </span>
      </button>
      {portalContent}
      {createName != null ? (
        <MasterVesselFormModal
          initialForm={{ ...EMPTY_VESSEL_FORM, vesselName: createName }}
          highlightPlanningFields
          stacked
          onClose={() => setCreateName(null)}
          onUseExisting={(vessel) => {
            const id = vessel?.id != null ? String(vessel.id) : ''
            if (!id || vessel.isActive === false) return
            onChange(id)
            setSelectedVessel(vessel)
            onVesselSelect?.(vessel)
          }}
          onSaved={(resp) => {
            const id = resp?.id != null ? String(resp.id) : ''
            if (id) {
              onChange(id)
              setSelectedVessel(resp)
              onVesselSelect?.(resp)
            }
            setToast(pushSaveToast(resp?.vesselName || createName, resp?.push))
          }}
        />
      ) : null}
      {toast ? <AppToast toast={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  )
}
