import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { fetchAdminOpsStatus, updateAdminOpsSettings } from '../api/adminOps'
import {
  StructuredCheckDetail,
  TechnicalJsonDetails,
} from '../components/admin/AdminOpsCheckDetails'
import {
  cardStatusClass,
  countChecksByStatus,
  formatRelativeTime,
  formatWhen,
  heroStatusClass,
  isNeedsAttention,
  sortChecksBySeverity,
  statusBadgeClass,
} from '../utils/adminOpsDisplay'
import '../styles/allocation.css'
import '../styles/admin.css'

function StatusHero({ data, statusLabel, t }) {
  if (!data?.overall) return null
  const counts = countChecksByStatus(data.checks)

  return (
    <section
      className={`admin-ops-hero ${heroStatusClass(data.overall)}`}
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="admin-ops-hero__main">
        <p className="admin-ops-hero__label">{t('adminOpsHeroLabel')}</p>
        <p className="admin-ops-hero__status">
          <span className={`admin-ops-hero__badge ${statusBadgeClass(data.overall)}`}>
            {statusLabel(data.overall)}
          </span>
        </p>
        <p className="admin-ops-hero__counts">
          {t('adminOpsHeroCounts', {
            unhealthy: counts.unhealthy,
            degraded: counts.degraded,
            unknown: counts.unknown,
            healthy: counts.healthy,
            disabled: counts.disabled,
          })}
        </p>
        {data.checkedAt ? (
          <p className="admin-ops-hero__checked">
            {t('adminOpsLastChecked')}: {formatRelativeTime(data.checkedAt)}
            <span className="admin-ops-hero__checked-exact" title={formatWhen(data.checkedAt)}>
              {' '}
              ({formatWhen(data.checkedAt)})
            </span>
          </p>
        ) : null}
      </div>
    </section>
  )
}

function CheckCard({ check, statusLabel, t }) {
  const [techOpen, setTechOpen] = useState(false)
  const guidanceKey = `adminOpsGuidance_${check.id}`
  const guidance =
    check.status === 'unknown' || check.status === 'unhealthy'
      ? t(guidanceKey, { defaultValue: '' })
      : ''

  return (
    <article className={`card admin-ops-card ${cardStatusClass(check.status)}`}>
      <div className="card__header-row">
        <div>
          <h2 className="card__title">{check.title}</h2>
          <p className="text-steel admin-ops-card__summary">{check.summary}</p>
          {guidance ? <p className="admin-ops-card__guidance">{guidance}</p> : null}
        </div>
        <span className={statusBadgeClass(check.status)}>{statusLabel(check.status)}</span>
      </div>

      {check.details ? (
        <div className="admin-ops-card__structured">
          <StructuredCheckDetail check={check} t={t} />
        </div>
      ) : null}

      {check.actionHref ? (
        <p className="admin-ops-card__actions">
          <Link to={check.actionHref} className="link">
            {check.actionLabel || t('adminOpsOpen')}
          </Link>
        </p>
      ) : null}

      <TechnicalJsonDetails
        details={check.details}
        open={techOpen}
        onToggle={() => setTechOpen((v) => !v)}
        t={t}
      />
    </article>
  )
}

function CheckSection({ title, checks, statusLabel, t }) {
  if (!checks.length) return null
  return (
    <section className="admin-ops-section">
      <h2 className="admin-ops-section__title">{title}</h2>
      <div className="admin-ops-grid">
        {checks.map((check) => (
          <CheckCard key={check.id} check={check} statusLabel={statusLabel} t={t} />
        ))}
      </div>
    </section>
  )
}

function EmailAlertsPanel({ data, loading, settingsSaving, settingsError, onToggle, t }) {
  const [open, setOpen] = useState(false)

  return (
    <section className="admin-ops-section admin-ops-alerts-section">
      <button
        type="button"
        className="admin-ops-section__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>{t('adminOpsAlertsTitle')}</span>
        <span className="admin-ops-section__toggle-hint">
          {data.emailAlertsEnabled
            ? data.emailAlertsActive
              ? t('adminOpsAlertsOn')
              : t('adminOpsAlertsPending')
            : t('adminOpsAlertsOff')}
        </span>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <article className="card admin-ops-card admin-ops-alerts-card">
          <label className="admin-notifications__toggle-row">
            <input
              type="checkbox"
              checked={Boolean(data.emailAlertsEnabled)}
              disabled={settingsSaving || loading}
              onChange={(e) => onToggle(e.target.checked)}
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
    </section>
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

  const sortedChecks = useMemo(
    () => sortChecksBySeverity(data?.checks ?? []),
    [data?.checks]
  )

  const attentionChecks = useMemo(
    () => sortedChecks.filter((c) => isNeedsAttention(c.status)),
    [sortedChecks]
  )

  const okChecks = useMemo(
    () => sortedChecks.filter((c) => c.status === 'healthy' || c.status === 'disabled'),
    [sortedChecks]
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
    <div className="allocation-page admin-ops-page">
      <div className="admin-ops-page-header">
        <div>
          <h1 className="page-title">{t('adminOpsTitle')}</h1>
          <p className="allocation-page__intro" style={{ marginBottom: 0 }}>
            <Link to="/admin" className="link">
              ← {t('adminOpsBack')}
            </Link>
          </p>
          <p className="text-steel admin-ops-page-header__intro">{t('adminOpsIntro')}</p>
        </div>
        <button type="button" className="btn btn--secondary admin-ops-refresh-btn" onClick={load} disabled={loading}>
          {loading ? t('adminOpsRefreshing') : t('adminOpsRefresh')}
        </button>
      </div>

      {error ? <p className="admin-ops-error">{error}</p> : null}
      {loading && !data ? <p className="text-steel">{t('adminOpsLoading')}</p> : null}

      {data ? (
        <>
          <StatusHero data={data} statusLabel={statusLabel} t={t} />

          <CheckSection
            title={t('adminOpsSectionAttention')}
            checks={attentionChecks}
            statusLabel={statusLabel}
            t={t}
          />

          <CheckSection
            title={t('adminOpsSectionOk')}
            checks={okChecks}
            statusLabel={statusLabel}
            t={t}
          />

          <EmailAlertsPanel
            data={data}
            loading={loading}
            settingsSaving={settingsSaving}
            settingsError={settingsError}
            onToggle={handleEmailAlertsToggle}
            t={t}
          />
        </>
      ) : null}
    </div>
  )
}
