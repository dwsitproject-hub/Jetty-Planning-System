import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

function matchesTankSearch(tk, term) {
  if (!term) return true
  const haystack = [tk.label, tk.code, tk.name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(term)
}

export default function OperatorTankPickerSheet({
  open,
  purpose,
  options,
  initialSelected = [],
  busy,
  onCancel,
  onConfirm,
}) {
  const { t } = useTranslation('operator')
  const [selected, setSelected] = useState(() => new Set(initialSelected.map(String)))
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (open) {
      setSelected(new Set(initialSelected.map(String)))
      setSearch('')
    }
  }, [open, initialSelected])

  const filteredOptions = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return options
    return options.filter((tk) => matchesTankSearch(tk, term))
  }, [options, search])

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

  return (
    <>
      <div className="operator-sheet-backdrop" onClick={onCancel} aria-hidden />
      <div className="operator-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="operator-sheet__header">
          <h2>{title}</h2>
          <p>{t('tank.requiredBeforeStart')}</p>
        </div>
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
              autoFocus
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
        <div className="operator-sheet__footer">
          <button type="button" className="op-btn" onClick={onCancel} disabled={busy}>
            {t('action.cancel')}
          </button>
          <button
            type="button"
            className="op-btn op-btn--primary"
            disabled={busy || selected.size === 0}
            onClick={() => onConfirm([...selected])}
          >
            {t('action.confirmStart')}
          </button>
        </div>
      </div>
    </>
  )
}
