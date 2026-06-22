/**
 * Prominent notice in Log arrival update when scheduling a plan before SI exists (late SI).
 */
export default function AllocationLateSiNotice({ title, body }) {
  if (!body) return null
  return (
    <div className="allocation-late-si-notice" role="status" aria-live="polite">
      <span className="allocation-late-si-notice__icon" aria-hidden="true">
        ⚠
      </span>
      <div className="allocation-late-si-notice__content">
        {title ? <p className="allocation-late-si-notice__title">{title}</p> : null}
        <p className="allocation-late-si-notice__text">{body}</p>
      </div>
    </div>
  )
}
