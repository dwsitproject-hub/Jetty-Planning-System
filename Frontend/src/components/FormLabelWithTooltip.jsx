import InteractiveTooltip from './InteractiveTooltip'

/**
 * Label or section heading with an info tooltip (ⓘ).
 * Used where helper text is too long for inline copy.
 */
export default function FormLabelWithTooltip({
  label,
  tooltip,
  as = 'label',
  className = 'berthing-modal__label',
  maxWidth = 320,
  placement = 'right',
}) {
  const infoIcon = tooltip ? (
    <InteractiveTooltip items={[{ primary: tooltip }]} maxWidth={maxWidth} placement={placement}>
      <span className="allocation-table__th-info" aria-label={tooltip}>
        ⓘ
      </span>
    </InteractiveTooltip>
  ) : null

  if (as === 'h4') {
    return (
      <h4 className="sampling-entry-block__title-row">
        <span className="sampling-entry-block__title">{label}</span>
        {infoIcon}
      </h4>
    )
  }

  return (
    <label className={className}>
      <span className="berthing-modal__label-row">
        <span>{label}</span>
        {infoIcon}
      </span>
    </label>
  )
}
