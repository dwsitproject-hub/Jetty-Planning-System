import { Link } from 'react-router-dom'

/**
 * Shown at legacy list URLs after product POV moved to plan-centric pages.
 * @param {{ title: string, body: string, primaryHref: string, primaryLabel: string, secondaryHref?: string, secondaryLabel?: string }} props
 */
export default function RetiredPage({ title, body, primaryHref, primaryLabel, secondaryHref, secondaryLabel }) {
  return (
    <div className="page-shell" style={{ maxWidth: '36rem', margin: '2rem auto', padding: '0 1rem' }}>
      <div className="card">
        <h1 className="page-title">{title}</h1>
        <p className="text-steel" style={{ lineHeight: 1.55 }}>
          {body}
        </p>
        <p style={{ marginTop: '1.25rem', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
          <Link to={primaryHref} className="btn btn--primary">
            {primaryLabel}
          </Link>
          {secondaryHref && secondaryLabel ? (
            <Link to={secondaryHref} className="btn btn--secondary">
              {secondaryLabel}
            </Link>
          ) : null}
        </p>
      </div>
    </div>
  )
}
