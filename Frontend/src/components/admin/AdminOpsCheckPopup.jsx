import { useEffect } from 'react'
import { CheckBody, CheckHeaderText } from './AdminOpsCheckCard.jsx'
import { formatRelativeTime, formatWhen, statusBadgeClass } from '../../utils/adminOpsDisplay'
import '../../styles/modal.css'

/** True while another dialog (e.g. ATG resync) is open on top of the pop-up. */
function hasDialogOnTop() {
  return document.querySelectorAll('.modal-overlay').length > 1
}

/**
 * Large view of one System Health check. Renders the live check from page data,
 * so actions inside (resync, acknowledge, refresh) update it in place.
 */
export default function AdminOpsCheckPopup({ check, checkedAt, loading, onRefresh, onClose, ctx }) {
  const { t } = ctx

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !hasDialogOnTop()) onClose()
    }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="modal-overlay admin-ops-popup-overlay" role="presentation" onClick={onClose}>
      <div
        className="modal admin-ops-popup"
        role="dialog"
        aria-modal="true"
        aria-label={check.title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="admin-ops-popup__header">
          <CheckHeaderText check={check} t={t} />
          <div className="admin-ops-popup__header-side">
            <span className={statusBadgeClass(check.status)}>{ctx.statusLabel(check.status)}</span>
            {checkedAt ? (
              <span className="text-steel admin-ops-popup__checked" title={formatWhen(checkedAt)}>
                {t('adminOpsLastChecked')}: {formatRelativeTime(checkedAt)}
              </span>
            ) : null}
            <button type="button" className="btn btn--secondary btn--sm" onClick={onRefresh} disabled={loading}>
              {loading ? t('adminOpsRefreshing') : t('adminOpsRefresh')}
            </button>
            <button
              type="button"
              className="admin-ops-popup__close"
              onClick={onClose}
              aria-label={t('adminOpsPopUpClose')}
            >
              ×
            </button>
          </div>
        </header>
        <div className="admin-ops-popup__body">
          <CheckBody check={check} ctx={ctx} />
        </div>
      </div>
    </div>
  )
}
