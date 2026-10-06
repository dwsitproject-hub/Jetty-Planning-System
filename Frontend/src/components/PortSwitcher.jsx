import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_SCHEDULE_TIMEZONE } from '../utils/scheduleDateTime.js'
import '../styles/port-switcher.css'

function AnchorIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="5" r="2.5" />
      <path d="M12 7.5V21" />
      <path d="M5 12H8.5C9.8 16 12 18 12 18s2.2-2 3.5-6H19" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="port-switcher__check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function ChipBody({ name, tz, showChevron }) {
  return (
    <>
      <span className="port-switcher__icon" aria-hidden>
        <AnchorIcon />
      </span>
      <span className="port-switcher__meta">
        <span className="port-switcher__name">{name}</span>
        <span className="port-switcher__tz">{tz}</span>
      </span>
      {showChevron ? (
        <span className="port-switcher__chevron" aria-hidden>
          <ChevronIcon />
        </span>
      ) : null}
    </>
  )
}

export default function PortSwitcher({ selectedPort, assignedPorts, onSelect }) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const canSwitch = assignedPorts.length > 1
  const portTz = selectedPort?.scheduleTimezone || DEFAULT_SCHEDULE_TIMEZONE
  const tzHint = t('portSwitcher.tzHint', { portTz })
  const name = selectedPort?.name || '—'

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const selectPort = (id) => {
    onSelect(id)
    setOpen(false)
  }

  return (
    <div className="port-switcher-wrap" ref={wrapRef}>
      {canSwitch ? (
        <button
          type="button"
          className={`port-switcher${open ? ' port-switcher--open' : ''}`}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={t('portSwitcher.switchPortAria', { name, tz: portTz })}
          title={tzHint}
        >
          <ChipBody name={name} tz={portTz} showChevron />
        </button>
      ) : (
        <div
          className="port-switcher port-switcher--static"
          title={tzHint}
          aria-label={t('portSwitcher.currentPort', { name, tz: portTz })}
        >
          <ChipBody name={name} tz={portTz} showChevron={false} />
        </div>
      )}

      {open && canSwitch ? (
        <div className="port-switcher__menu" role="listbox" aria-label={t('portSwitcher.switchPort')}>
          {assignedPorts.map((port) => {
            const selected = Number(port.id) === Number(selectedPort?.id)
            return (
              <button
                key={port.id}
                type="button"
                role="option"
                aria-selected={selected}
                className={`port-switcher__option${selected ? ' port-switcher__option--active' : ''}`}
                onClick={() => selectPort(port.id)}
              >
                <span className="port-switcher__option-name">{port.name}</span>
                <span className="port-switcher__option-tz">
                  {port.scheduleTimezone || DEFAULT_SCHEDULE_TIMEZONE}
                </span>
                {selected ? <CheckIcon /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
