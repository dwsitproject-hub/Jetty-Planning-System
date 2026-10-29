import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { partnerDocumentLinks } from '../utils/partnerDocumentLinks'
import { usePartnerDocsTitle } from '../hooks/usePartnerDocsTitle'
import PartnerDocumentLinks from './PartnerDocumentLinks'
import '../styles/partner-documents.css'

const MENU_GAP_PX = 4

/**
 * Document icon with a count next to an SI reference. Renders nothing unless the SI has
 * at least one valid partner document URL; the menu lists the same links as the SI detail card.
 */
export default function PartnerDocumentsCue({ si }) {
  const { t } = useTranslation('shippingInstruction')
  const links = useMemo(() => partnerDocumentLinks(si), [si])
  const title = usePartnerDocsTitle(si?.partnerName)
  const [pos, setPos] = useState(null)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)

  const close = useCallback(() => setPos(null), [])

  useEffect(() => {
    if (!pos) return undefined
    const onPointerDown = (e) => {
      if (menuRef.current?.contains(e.target) || buttonRef.current?.contains(e.target)) return
      close()
    }
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return
      close()
      buttonRef.current?.focus()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [pos, close])

  if (links.length === 0) return null

  const toggle = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (pos) {
      close()
      return
    }
    const rect = buttonRef.current.getBoundingClientRect()
    setPos({ top: rect.bottom + MENU_GAP_PX, left: rect.left })
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="partner-docs-cue"
        aria-haspopup="true"
        aria-expanded={pos != null}
        aria-label={t('partnerDocsCueAria', { title, count: links.length })}
        title={title}
        onClick={toggle}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M4 1.5A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8a1.5 1.5 0 0 0 1.5-1.5V6.06a1.5 1.5 0 0 0-.44-1.06L9.5 1.44A1.5 1.5 0 0 0 8.44 1H4Zm4.25 1.56L11.94 6.75H9A.75.75 0 0 1 8.25 6V3.06ZM5 8.75h6a.75.75 0 0 1 0 1.5H5a.75.75 0 0 1 0-1.5Zm0 2.5h4a.75.75 0 0 1 0 1.5H5a.75.75 0 0 1 0-1.5Z"
          />
        </svg>
        <span className="partner-docs-cue__count" aria-hidden="true">{links.length}</span>
      </button>
      {pos
        ? createPortal(
            <div
              ref={menuRef}
              className="partner-docs partner-docs--menu"
              role="dialog"
              aria-label={title}
              style={{ top: pos.top, left: pos.left }}
              onClick={(e) => e.stopPropagation()}
            >
              <h4 className="partner-docs__title">{title}</h4>
              <PartnerDocumentLinks links={links} />
            </div>,
            document.body
          )
        : null}
    </>
  )
}
