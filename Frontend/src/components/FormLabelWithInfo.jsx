import InteractiveTooltip from './InteractiveTooltip'

/**
 * Form field label with optional ⓘ tooltip (hover / focus).
 */
export default function FormLabelWithInfo({ htmlFor, children, infoTooltip }) {
  return (
    <div className="form-label-with-info">
      <label htmlFor={htmlFor}>{children}</label>
      {infoTooltip ? (
        <InteractiveTooltip items={[{ primary: infoTooltip }]} maxWidth={300} placement="right">
          <span className="form-label-with-info__icon" aria-label={infoTooltip} tabIndex={0} role="img">
            ⓘ
          </span>
        </InteractiveTooltip>
      ) : null}
    </div>
  )
}
