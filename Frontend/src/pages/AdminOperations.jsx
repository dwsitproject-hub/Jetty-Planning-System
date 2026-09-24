import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { fetchAdminOpsStatus, updateAdminOpsSettings } from '../api/adminOps'
import '../styles/allocation.css'
import '../styles/admin.css'

function formatWhen(value) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function statusBadgeClass(status) {
  switch (status) {
    case 'healthy':
      return 'admin-status-badge admin-status-badge--active'
    case 'degraded':
      return 'admin-status-badge admin-status-badge--warning'
    case 'unhealthy':
      return 'admin-status-badge admin-status-badge--error'
    case 'disabled':
      return 'admin-status-badge admin-status-badge--inactive'
    default:
      return 'admin-status-badge admin-status-badge--inactive'
  }
}

function formatCount(n) {
  const num = Number(n)
  if (!Number.isFinite(num)) return '—'
  return num.toLocaleString()
}

function PurgeBatchTable({ batches, t }) {
  if (!batches?.length) {
    return <p className="text-steel admin-ops-purge-table__empty">{t('adminOpsPurgeNoBatches')}</p>
  }

  return (
    <div className="admin-ops-purge-table-wrap">
      <h3 className="admin-ops-purge-table__title">{t('adminOpsPurgeBatchLogTitle')}</h3>
      <table className="admin-ops-purge-table">
        <thead>
          <tr>
            <th>{t('adminOpsPurgeBatchId')}</th>
            <th className="admin-ops-purge-table__num">{t('adminOpsPurgeArchive')}</th>
            <th className="admin-ops-purge-table__num">{t('adminOpsPurgeDelete')}</th>
            <th>{t('adminOpsPurgeRunWindow')}</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => (
            <tr key={batch.batchId}>
              <td className="admin-ops-purge-table__batch" title={batch.batchId}>
                <code>{batch.batchId}</code>
              </td>
              <td className="admin-ops-purge-table__num">{formatCount(batch.archived)}</td>
              <td className="admin-ops-purge-table__num">{formatCount(batch.deleted)}</td>
              <td className="admin-ops-purge-table__window">
                {formatWhen(batch.firstActedAt)}
                {batch.firstActedAt !== batch.lastActedAt ? (
                  <>
                    {' '}
                    → {formatWhen(batch.lastActedAt)}
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CheckCard({ check, statusLabel, t }) {
  const [open, setOpen] = useState(false)
  const purgeBatches = check.id === 'purge_job' ? check.details?.recentBatches : null
  const hasRawDetails =
    check.details && Object.keys(check.details).some((key) => key !== 'recentBatches')

  return (
    <article className="card admin-ops-card">
      <div className="card__header-row">
        <div>
          <h2 className="card__title">{check.title}</h2>
          <p className="text-steel admin-ops-card__summary">{check.summary}</p>
        </div>
        <span className={statusBadgeClass(check.status)}>{statusLabel(check.status)}</span>
      </div>

      {check.id === 'purge_job' ? (
        <PurgeBatchTable batches={purgeBatches ?? []} t={t} />
      ) : null}

      {check.actionHref ? (
        <p className="admin-ops-card__actions">
          <Link to={check.actionHref} className="link">
            {check.actionLabel || 'Open'}
          </Link>
        </p>
      ) : null}

      {hasRawDetails ? (
        <div className="admin-ops-card__details">
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? t('adminOpsHideDetails') : t('adminOpsShowDetails')}
          </button>
          {open ? (
            <pre className="admin-ops-card__json">{JSON.stringify(check.details, null, 2)}</pre>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

export default function AdminOperations() {
  const { t } = useTranslation('pages')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsError, setSettingsError] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      setData(await fetchAdminOpsStatus())
    } catch (e) {
      let msg = e?.message || 'Failed to load operations status'
      if (e?.status === 404) {
        msg =
          'System health status API not found. Restart the backend (npm run dev in Backend/) after pulling the latest code, then refresh.'
      } else if (e?.status === 403) {
        msg = 'Admin permission required to view operations status.'
      }
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const statusLabel = useCallback(
    (status) => t(`adminOpsStatus_${status}`, status),
    [t]
  )

  const handleEmailAlertsToggle = async (enabled) => {
    setSettingsSaving(true)
    setSettingsError(null)
    try {
      const settings = await updateAdminOpsSettings({ emailAlertsEnabled: enabled })
      setData((prev) =>
        prev
          ? {
              ...prev,
              emailAlertsEnabled: settings.emailAlertsEnabled,
              emailAlertsActive: settings.emailAlertsActive,
              alertEmail: settings.alertEmail,
              smtpConfigured: settings.smtpConfigured,
            }
          : prev
      )
    } catch (e) {
      setSettingsError(e?.message || 'Failed to save alert settings')
    } finally {
      setSettingsSaving(false)
    }
  }

  return (
    <div className="allocation-page">
      <h1 className="page-title">{t('adminOpsTitle')}</h1>
      <p className="allocation-page__intro">
        <Link to="/admin" className="link">
          ← {t('adminOpsBack')}
        </Link>
      </p>
      <p className="text-steel" style={{ marginTop: 0 }}>
        {t('adminOpsIntro')}
      </p>

      <div className="card__header-row" style={{ marginBottom: 16 }}>
        {data?.checkedAt ? (
          <p className="text-steel" style={{ margin: 0 }}>
            {t('adminOpsLastChecked')}: {formatWhen(data.checkedAt)}
            {data.overall ? (
              <>
                {' '}
                · {t('adminOpsOverall')}:{' '}
                <span className={statusBadgeClass(data.overall)}>{statusLabel(data.overall)}</span>
              </>
            ) : null}
          </p>
        ) : null}
        <button type="button" className="btn btn--secondary btn--small" onClick={load} disabled={loading}>
          {loading ? t('adminOpsRefreshing') : t('adminOpsRefresh')}
        </button>
      </div>

      {error ? <p style={{ color: '#c00' }}>{error}</p> : null}
      {loading && !data ? <p className="text-steel">{t('adminOpsLoading')}</p> : null}

      {data ? (
        <article className="card admin-ops-card" style={{ marginBottom: 16 }}>
          <h2 className="card__title">{t('adminOpsAlertsTitle')}</h2>
          <label className="admin-notifications__toggle-row">
            <input
              type="checkbox"
              checked={Boolean(data.emailAlertsEnabled)}
              disabled={settingsSaving || loading}
              onChange={(e) => handleEmailAlertsToggle(e.target.checked)}
            />
            <span>{t('adminOpsAlertsEnable')}</span>
          </label>
          <p className="text-steel admin-ops-card__summary" style={{ marginTop: 8 }}>
            {t('adminOpsAlertsRecipient', { email: data.alertEmail || 'it-project@energi-up.com' })}
          </p>
          {data.emailAlertsEnabled && !data.emailAlertsActive ? (
            <p className="admin-notifications__hint admin-notifications__hint--warn" style={{ marginTop: 8 }}>
              {t('adminOpsAlertsInactive')}
            </p>
          ) : null}
          {data.emailAlertsEnabled && data.emailAlertsActive ? (
            <p className="text-steel" style={{ marginTop: 8, marginBottom: 0 }}>
              {t('adminOpsAlertsActive')}
            </p>
          ) : null}
          {settingsError ? <p style={{ color: '#c00', marginTop: 8 }}>{settingsError}</p> : null}
        </article>
      ) : null}

      <div className="admin-ops-grid">
        {(data?.checks ?? []).map((check) => (
          <CheckCard key={check.id} check={check} statusLabel={statusLabel} t={t} />
        ))}
      </div>
    </div>
  )
}
