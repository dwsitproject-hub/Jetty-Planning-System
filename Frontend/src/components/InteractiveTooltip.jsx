import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

function hasMeasurableRect(el) {
  if (!(el instanceof HTMLElement)) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

/** Pick a child with a real layout box (survives display:contents on the trigger). */
function resolveAnchorElement(triggerEl, interactiveChild) {
  if (!triggerEl) return null
  const candidates = []
  if (interactiveChild && triggerEl.firstElementChild instanceof HTMLElement) {
    candidates.push(triggerEl.firstElementChild)
  }
  candidates.push(triggerEl)
  for (const el of triggerEl.querySelectorAll(
    'button, [role="img"], .jetty-schedule-gantt__bar, .jetty-schedule-gantt__segmented-group'
  )) {
    if (el instanceof HTMLElement) candidates.push(el)
  }
  const seen = new Set()
  for (const el of candidates) {
    if (seen.has(el)) continue
    seen.add(el)
    if (hasMeasurableRect(el)) return el
  }
  return triggerEl.firstElementChild instanceof HTMLElement
    ? triggerEl.firstElementChild
    : triggerEl
}

/**
 * Lightweight portal tooltip anchored to a trigger element.
 * UX modeled after DashboardActivityChart tooltip (clamp/flip + close on scroll/resize).
 */
export default function InteractiveTooltip({
  title,
  subtitle,
  items = [],
  emptyText = 'No items.',
  maxWidth = 320,
  maxHeight = 220,
  placement = 'left', // 'left' | 'right'
  interactiveChild = false,
  children,
}) {
  const triggerRef = useRef(null)
  const tooltipRef = useRef(null)
  const closeTimerRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null) // { left, top, flip }

  const safeItems = useMemo(() => (Array.isArray(items) ? items : []), [items])

  const cancelScheduledClose = useCallback(() => {
    if (closeTimerRef.current != null) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const close = useCallback(() => {
    cancelScheduledClose()
    setOpen(false)
    setPos(null)
  }, [cancelScheduledClose])

  // Small grace period before closing so the cursor can travel from the trigger
  // to the portal-rendered tooltip (a separate DOM subtree) without it vanishing,
  // e.g. to scroll a long vessel list.
  const scheduleClose = useCallback(() => {
    cancelScheduledClose()
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null
      setOpen(false)
      setPos(null)
    }, 150)
  }, [cancelScheduledClose])

  useEffect(() => () => cancelScheduledClose(), [cancelScheduledClose])

  const computePosition = useCallback(() => {
    const el = triggerRef.current
    if (!el) return null
    // For absolutely-positioned interactive children (e.g. Gantt bars), measure the child box
    // instead of the inline wrapper span so tooltip anchor follows the visual target.
    const anchor = resolveAnchorElement(el, interactiveChild)
    if (!anchor) return null
    const r = anchor.getBoundingClientRect()
    const gap = 10
    const estW = Math.min(maxWidth, 360)
    const viewportPad = 12
    let flip = false

    let left = placement === 'right' ? r.right + gap : r.left - gap - estW
    if (left < viewportPad) {
      left = r.right + gap
      flip = true
    }
    if (left + estW > window.innerWidth - viewportPad) {
      left = window.innerWidth - viewportPad - estW
    }
    const top = clamp(r.top + r.height / 2, viewportPad + 10, window.innerHeight - viewportPad - 10)
    return { left, top, flip }
  }, [interactiveChild, maxWidth, placement])

  const openNow = useCallback(() => {
    cancelScheduledClose()
    const p = computePosition()
    if (!p) return
    setPos(p)
    setOpen(true)
  }, [cancelScheduledClose, computePosition])

  const onKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') close()
    },
    [close]
  )

  useEffect(() => {
    if (!open) return undefined
    const onScroll = (e) => {
      // Capture-phase listener sees scrolls from *any* descendant, including the
      // tooltip's own scrollable vessel list — ignore those so scrolling the list
      // doesn't close it. Only close when an ancestor of the trigger scrolls,
      // which would invalidate the computed anchor position.
      const target = e.target
      if (tooltipRef.current && target instanceof Node && tooltipRef.current.contains(target)) {
        return
      }
      close()
    }
    const onResize = () => close()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close, onKeyDown])

  const tip =
    open && pos
      ? createPortal(
          <div
            ref={tooltipRef}
            className={`jps-tooltip${pos.flip ? ' jps-tooltip--flip' : ''}`}
            style={{ left: pos.left, top: pos.top, ['--jps-tooltip-maxw']: `${maxWidth}px`, ['--jps-tooltip-maxh']: `${maxHeight}px` }}
            role="tooltip"
            onMouseEnter={cancelScheduledClose}
            onMouseLeave={scheduleClose}
          >
            <div className="jps-tooltip__inner">
              {title ? <div className="jps-tooltip__title">{title}</div> : null}
              {subtitle ? <div className="jps-tooltip__subtitle">{subtitle}</div> : null}
              {safeItems.length > 0 ? (
                <ul className="jps-tooltip__list">
                  {safeItems.map((it, idx) => {
                    if (it && typeof it === 'object' && ('primary' in it || 'secondary' in it)) {
                      const primary = String(it.primary ?? '').trim() || '—'
                      const secondary = it.secondary != null && String(it.secondary).trim() ? String(it.secondary) : null
                      return (
                        <li key={idx} className="jps-tooltip__item">
                          <div className="jps-tooltip__item-primary">{primary}</div>
                          {secondary ? <div className="jps-tooltip__item-secondary">{secondary}</div> : null}
                        </li>
                      )
                    }
                    const s = it == null ? '—' : String(it)
                    return (
                      <li key={idx} className="jps-tooltip__item">
                        <div className="jps-tooltip__item-primary">{s}</div>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <div className="jps-tooltip__empty">{emptyText}</div>
              )}
            </div>
          </div>,
          document.body
        )
      : null

  return (
    <>
      <span
        ref={triggerRef}
        className="jps-tooltip-trigger"
        onMouseEnter={openNow}
        onMouseLeave={scheduleClose}
        onFocus={openNow}
        onBlur={close}
        tabIndex={interactiveChild ? undefined : 0}
        role={interactiveChild ? undefined : 'button'}
        aria-haspopup={interactiveChild ? undefined : 'true'}
        aria-expanded={interactiveChild ? undefined : open ? 'true' : 'false'}
      >
        {children}
      </span>
      {tip}
    </>
  )
}

