const ITEMS = [
  { key: 'ok', className: 'cargo-movement-legend__swatch', style: { background: 'var(--cm-atg, #2a7a5c)' } },
  { key: 'manual', className: 'cargo-movement-legend__swatch cargo-movement-legend__swatch--manual' },
  { key: 'gap', className: 'cargo-movement-legend__swatch', style: { background: '#fef3c7', borderColor: '#c2780a' } },
  { key: 'progress', className: 'cargo-movement-legend__swatch', style: { background: 'rgba(37,99,235,0.25)', borderColor: '#2563eb' } },
]

export default function CargoMovementLegend({ t }) {
  return (
    <div className="cargo-movement-legend" aria-label={t('cargoMovementLegendAria')}>
      {ITEMS.map((item) => (
        <span key={item.key} className="cargo-movement-legend__item">
          <span className={item.className} style={item.style} aria-hidden />
          {t(`cargoMovementLegend_${item.key}`)}
        </span>
      ))}
    </div>
  )
}
