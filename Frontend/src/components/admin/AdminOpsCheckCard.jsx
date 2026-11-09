import { useState } from 'react'
import { Link } from 'react-router-dom'
import { StructuredCheckDetail, TechnicalJsonDetails } from './AdminOpsCheckDetails'
import { cardStatusClass, statusBadgeClass } from '../../utils/adminOpsDisplay'
import { checkHighlights } from '../../utils/adminOpsCheckHighlights'

/** Title, summary and guidance shared by the card and the pop-up header. */
export function CheckHeaderText({ check, t, as: Heading = 'h2' }) {
  const showGuidance =
    check.status === 'unknown' ||
    check.status === 'unhealthy' ||
    ((check.id === 'atg_cargo_gaps' || check.id === 'manual_override') && check.status === 'degraded')
  const guidance = showGuidance ? t(`adminOpsGuidance_${check.id}`, { defaultValue: '' }) : ''

  return (
    <div>
      <Heading className="card__title">{check.title}</Heading>
      <p className="text-steel admin-ops-card__summary">{check.summary}</p>
      {guidance ? <p className="admin-ops-card__guidance">{guidance}</p> : null}
    </div>
  )
}

/** Check details, action link and technical JSON, shared by the card and the pop-up. */
export function CheckBody({ check, ctx }) {
  const [techOpen, setTechOpen] = useState(false)
  const { t } = ctx

  return (
    <>
      {check.details ? (
        <div className="admin-ops-card__structured">
          <StructuredCheckDetail
            check={check}
            t={t}
            canResyncAtg={ctx.canResyncAtg}
            onAtgGapsChanged={ctx.onAtgGapsChanged}
          />
        </div>
      ) : null}

      {check.actionHref ? (
        <p className="admin-ops-card__actions">
          <Link to={check.actionHref} className="link">
            {check.actionLabel || t('adminOpsOpen')}
          </Link>
        </p>
      ) : null}

      <TechnicalJsonDetails details={check.details} open={techOpen} onToggle={() => setTechOpen((v) => !v)} t={t} />
    </>
  )
}

function CheckHighlights({ check, t }) {
  const items = checkHighlights(check)
  if (!items.length) return null
  return (
    <dl className="admin-ops-card__keys">
      {items.map((item) => (
        <div key={item.labelKey} className="admin-ops-card__key">
          <dt>{t(item.labelKey)}</dt>
          <dd>{item.translateValue ? t(`adminOpsKeyValue_${item.value}`) : item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Summary-only card; full details, tables and JSON open in the pop-up. */
function CheckCard({ check, ctx }) {
  const { t } = ctx

  return (
    <article className={`card admin-ops-card ${cardStatusClass(check.status)}`}>
      <div className="card__header-row">
        <CheckHeaderText check={check} t={t} />
        <span className={statusBadgeClass(check.status)}>{ctx.statusLabel(check.status)}</span>
      </div>
      <CheckHighlights check={check} t={t} />
      <div className="admin-ops-card__footer">
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={() => ctx.onPopUp(check.id)}
          aria-label={t('adminOpsOpenDetailsAria', { title: check.title })}
        >
          {t('adminOpsOpenDetails')}
        </button>
        {check.actionHref ? (
          <Link to={check.actionHref} className="link">
            {check.actionLabel || t('adminOpsOpen')}
          </Link>
        ) : null}
      </div>
    </article>
  )
}

export function CheckSection({ title, checks, ctx }) {
  if (!checks.length) return null
  return (
    <section className="admin-ops-section">
      <h2 className="admin-ops-section__title">{title}</h2>
      <div className="admin-ops-grid">
        {checks.map((check) => (
          <CheckCard key={check.id} check={check} ctx={ctx} />
        ))}
      </div>
    </section>
  )
}
