import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import '../styles/modal.css'

const ARM_MS = 400

function listboxOpen() {
  return Boolean(document.querySelector('[role="listbox"]'))
}

/** A read-only dialog stacked above this form should keep its own Escape behavior. */
function laterViewerCovers(el) {
  const overlays = [...document.querySelectorAll('.modal-overlay')]
  const index = overlays.indexOf(el)
  if (index < 0) return false
  return overlays.slice(index + 1).some((node) => !node.classList.contains('sticky-form-overlay'))
}

export function StickyFormHint({ show }) {
  const { t } = useTranslation('common')
  if (!show) return null
  return (
    <p className="sticky-form-hint" role="status">
      {t('stickyFormHint')}
    </p>
  )
}

/**
 * Keeps a data-entry dialog open when the dimmed area or Escape is used.
 * Close and Cancel stay the only ways out. A nudge and hint explain that.
 */
export function useStickyFormDismiss() {
  const overlayNodeRef = useRef(null)
  const openedAtRef = useRef(Date.now())
  const listboxOnPointerDownRef = useRef(false)
  const escapeHadListboxRef = useRef(false)
  const nudgeTimerRef = useRef(null)
  const [nudgeOn, setNudgeOn] = useState(false)
  const [showHint, setShowHint] = useState(false)

  const overlayRef = useCallback((node) => {
    overlayNodeRef.current = node
    if (node) openedAtRef.current = Date.now()
  }, [])

  const isTopmost = useCallback(() => {
    const all = document.querySelectorAll('.sticky-form-overlay')
    return all.length > 0 && all[all.length - 1] === overlayNodeRef.current
  }, [])

  const triggerNudge = useCallback(() => {
    setShowHint(true)
    setNudgeOn(false)
    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current)
    nudgeTimerRef.current = setTimeout(() => setNudgeOn(true), 20)
  }, [])

  useEffect(() => {
    openedAtRef.current = Date.now()
    return () => {
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const onMouseDown = (e) => {
      if (!overlayNodeRef.current || e.target !== overlayNodeRef.current) return
      if (!isTopmost()) return
      listboxOnPointerDownRef.current = listboxOpen()
    }

    const onKeyDownCapture = (e) => {
      if (e.key !== 'Escape') return
      if (!isTopmost()) return
      if (laterViewerCovers(overlayNodeRef.current)) return
      escapeHadListboxRef.current = listboxOpen()
      if (escapeHadListboxRef.current) return
      e.preventDefault()
      e.stopPropagation()
      triggerNudge()
    }

    // Runs after an in-dialog list closes itself, and blocks page listeners
    // on window from dismissing the form on the same Escape.
    const onKeyDownBubble = (e) => {
      if (e.key !== 'Escape') return
      if (!isTopmost()) return
      if (!escapeHadListboxRef.current) return
      escapeHadListboxRef.current = false
      e.stopImmediatePropagation()
    }

    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('keydown', onKeyDownCapture, true)
    window.addEventListener('keydown', onKeyDownBubble)
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('keydown', onKeyDownCapture, true)
      window.removeEventListener('keydown', onKeyDownBubble)
    }
  }, [isTopmost, triggerNudge])

  const onBackdropClick = useCallback((e) => {
    if (e.target !== e.currentTarget) return
    if (listboxOnPointerDownRef.current) {
      listboxOnPointerDownRef.current = false
      return
    }
    if (Date.now() - openedAtRef.current < ARM_MS) return
    triggerNudge()
  }, [triggerNudge])

  return {
    overlayRef,
    onBackdropClick,
    showHint,
    nudgeClassName: nudgeOn ? 'is-nudging' : '',
  }
}

export default function StickyFormOverlay({ children, className = '' }) {
  const { overlayRef, onBackdropClick, showHint, nudgeClassName } = useStickyFormDismiss()
  const classes = ['modal-overlay', 'sticky-form-overlay', nudgeClassName, className]
    .filter(Boolean)
    .join(' ')

  return (
    <div ref={overlayRef} className={classes} onClick={onBackdropClick} role="presentation">
      <StickyFormHint show={showHint} />
      {children}
    </div>
  )
}
