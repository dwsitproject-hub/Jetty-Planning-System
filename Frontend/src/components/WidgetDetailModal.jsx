/**
 * Shared "widget detail" modal — click-through drill-down for dashboard
 * KPI/widget cards. Shows an optional stats summary plus a data table.
 * Originally introduced in the Management Dashboard; reused across dashboards
 * so widgets share one modal look/behavior instead of hover tooltips.
 */
import '../styles/modal.css'
import '../styles/management-dashboard.css'

export default function WidgetDetailModal({ modal, onClose }) {
  if (!modal) return null
  return (
    <div className="modal-overlay" onClick={onClose} aria-hidden="true">
      <div
        className="modal modal--wide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="widget-detail-modal-title"
        aria-modal="true"
      >
        <div className="mgmt-modal-header">
          <h2 id="widget-detail-modal-title" className="modal__title">{modal.title}</h2>
          <button type="button" className="mgmt-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        {modal.subtitle ? <p className="text-steel mgmt-sub" style={{ marginTop: 0 }}>{modal.subtitle}</p> : null}
        {modal.stats?.length ? (
          <div className="mgmt-modal-summary">
            {modal.stats.map((s) => (
              <div key={s.label} className="mgmt-modal-summary__item">
                <span className="mgmt-modal-summary__lbl">{s.label}</span>
                <span className="mgmt-modal-summary__val">{s.value}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {modal.columns.map((c) => (
                  <th key={c.label} className={c.align === 'right' ? 'mgmt-r' : ''}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modal.rows.length ? modal.rows.map((row, i) => (
                <tr key={row.id ?? row._key ?? i}>
                  {modal.columns.map((c) => (
                    <td key={c.label} className={c.align === 'right' ? 'mgmt-r' : ''}>{c.cell(row)}</td>
                  ))}
                </tr>
              )) : (
                <tr><td colSpan={modal.columns.length} className="text-steel">{modal.emptyText || 'No voyages in this view.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {modal.footer ? <p className="mgmt-modal-foot">{modal.footer}</p> : null}
      </div>
    </div>
  )
}
