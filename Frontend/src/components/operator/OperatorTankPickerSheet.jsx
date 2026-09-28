import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  defaultCommodityIdForNewLine,
  findSiCommodityOption,
  formatSiCommodityPlanHint,
  normalizeSiCommodityOptions,
  requiresCommodityPicker,
} from '../../utils/siCommodityOptions.js'
import { buildTankCommodityMismatchWarnings } from '../../utils/tankCommodityMismatch.js'

function matchesTankSearch(tk, term) {
  if (!term) return true
  const haystack = [tk.label, tk.code, tk.name, tk.productName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(term)
}

export default function OperatorTankPickerSheet({
  open,
  purpose,
  options,
  siCommodityOptions = [],
  initialSelected = [],
  initialCommodityId = null,
  busy,
  onCancel,
  onConfirm,
}) {
  const { t } = useTranslation('operator')
  const commodities = useMemo(
    () => normalizeSiCommodityOptions(siCommodityOptions),
    [siCommodityOptions]
  )
  const showCommodityPicker = requiresCommodityPicker(commodities)
  const [selected, setSelected] = useState(() => new Set(initialSelected.map(String)))
  const [search, setSearch] = useState('')
  const [commodityId, setCommodityId] = useState(() => {
    const d = defaultCommodityIdForNewLine(commodities, initialCommodityId)
    return d || ''
  })

  useEffect(() => {
    if (open) {
      setSelected(new Set(initialSelected.map(String)))
      setSearch('')
      const d = defaultCommodityIdForNewLine(commodities, initialCommodityId)
      setCommodityId(d || '')
    }
  }, [open, initialSelected, initialCommodityId, commodities])

  const filteredOptions = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return options
    return options.filter((tk) => matchesTankSearch(tk, term))
  }, [options, search])

  const tankMetaById = useMemo(() => {
    const m = new Map()
    for (const tk of options || []) {
      m.set(String(tk.id), tk)
    }
    return m
  }, [options])

  const mismatchWarnings = useMemo(() => {
    const opt = findSiCommodityOption(commodities, commodityId)
    return buildTankCommodityMismatchWarnings(opt?.shortName, [...selected], tankMetaById)
  }, [commodities, commodityId, selected, tankMetaById])

  if (!open) return null

  const title =
    purpose === 'Unloading' ? t('tank.selectSource') : t('tank.selectDestination')

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const canConfirm =
    selected.size > 0 && (!showCommodityPicker || Boolean(commodityId))

  return (
    <>
      <div className="operator-sheet-backdrop" onClick={onCancel} aria-hidden />
      <div className="operator-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="operator-sheet__header">
          <h2>{title}</h2>
          <p>{t('tank.requiredBeforeStart')}</p>
        </div>
        {showCommodityPicker ? (
          <div className="operator-sheet__commodity">
            <p className="operator-sheet__commodity-label">{t('cargo.whichProduct')}</p>
            <div className="operator-sheet__commodity-chips">
              {commodities.map((o) => {
                const on = commodityId === o.commodityId
                const hint = formatSiCommodityPlanHint(o)
                return (
                  <button
                    key={o.commodityId}
                    type="button"
                    className={`operator-commodity-chip${on ? ' is-selected' : ''}`}
                    onClick={() => setCommodityId(o.commodityId)}
                  >
                    <span className="operator-commodity-chip__name">{o.shortName}</span>
                    {hint ? (
                      <span className="operator-commodity-chip__hint">{t('cargo.planQty', { qty: hint })}</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}
        {options.length > 0 ? (
          <div className="operator-sheet__search">
            <input
              type="search"
              className="operator-sheet__search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('tank.searchPlaceholder')}
              aria-label={t('tank.searchPlaceholder')}
              autoComplete="off"
              inputMode="search"
              autoFocus={!showCommodityPicker}
            />
          </div>
        ) : null}
        <div className="operator-sheet__body">
          {options.length === 0 ? (
            <p className="operator-queue__status">{t('tank.noneAvailable')}</p>
          ) : filteredOptions.length === 0 ? (
            <p className="operator-queue__status">{t('tank.noMatches')}</p>
          ) : (
            filteredOptions.map((tk) => {
              const id = String(tk.id)
              const isOn = selected.has(id)
              return (
                <button
                  key={id}
                  type="button"
                  className={`operator-tank-chip${isOn ? ' is-selected' : ''}`}
                  onClick={() => toggle(id)}
                >
                  <span className="operator-tank-chip__check">{isOn ? '✓' : ''}</span>
                  <span>{tk.label}</span>
                </button>
              )
            })
          )}
        </div>
        {mismatchWarnings.length > 0 ? (
          <p className="operator-sheet__warn" role="status">
            {mismatchWarnings.join(' ')}
          </p>
        ) : null}
        <div className="operator-sheet__footer">
          <button type="button" className="op-btn" onClick={onCancel} disabled={busy}>
            {t('action.cancel')}
          </button>
          <button
            type="button"
            className="op-btn op-btn--primary"
            disabled={busy || !canConfirm}
            onClick={() =>
              onConfirm({
                tankIds: [...selected],
                commodityId: showCommodityPicker ? commodityId : commodities[0]?.commodityId ?? null,
              })
            }
          >
            {t('action.confirmStart')}
          </button>
        </div>
      </div>
    </>
  )
}
