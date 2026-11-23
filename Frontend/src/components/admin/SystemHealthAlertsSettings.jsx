import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { fetchAdminOpsSettings, updateAdminOpsSettings } from '../../api/adminOps'

/**
 * @param {{
 *   smtpConfigured: boolean,
 *   onToast: (opts: { kind: 'success' | 'error', text: string }) => void,
 *   onSaved?: () => void,
 * }} props
 */
export default function SystemHealthAlertsSettings({ smtpConfigured, onToast, onSaved }) {
  const { t } = useTranslation('pages')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const [enabled, setEnabled] = useState(false)
  const [defaultEmail, setDefaultEmail] = useState('')
  const [rows, setRows] = useState([])
  const [recipientEmails, setRecipientEmails] = useState({})

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const data = await fetchAdminOpsSettings()
      setEnabled(Boolean(data.emailAlertsEnabled))
      setDefaultEmail(data.alertEmail || '')
      setRows(data.recipients || [])
      const map = {}
      for (const row of data.recipients || []) {
        const key = `${row.checkId}:${row.portId ?? ''}`
        map[key] = row.email || ''
      }
      setRecipientEmails(map)
    } catch (e) {
      setErr(e?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleSave = async () => {
    setSaving(true)
    setErr(null)
    try {
      const recipients = rows.map((row) => {
        const key = `${row.checkId}:${row.portId ?? ''}`
        return {
          checkId: row.checkId,
          portId: row.portId ?? null,
          email: String(recipientEmails[key] || '').trim(),
        }
      })
      await updateAdminOpsSettings({
        emailAlertsEnabled: enabled,
        alertEmail: defaultEmail.trim(),
        recipients,
      })
      onToast({ kind: 'success', text: t('notifAdminSysHealthSaved') })
      await load()
      onSaved?.()
    } catch (e) {
      const msg = e?.message || 'Failed to save'
      setErr(msg)
      onToast({ kind: 'error', text: msg })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p>{t('notifAdminLoading')}</p>
  }

  return (
    <div className="admin-notifications__syshealth" id="system-health">
      <p className="text-steel admin-notifications__syshealth-intro">{t('notifAdminSysHealthIntro')}</p>
      <p className="text-steel">
        <Link to="/admin/operations" className="link">
          {t('notifAdminSysHealthDashboardLink')}
        </Link>
      </p>

      <label className="admin-notifications__toggle-row" style={{ marginTop: 12 }}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={saving}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span>{t('notifAdminSysHealthEnable')}</span>
      </label>

      <div className="admin-notifications__field" style={{ marginTop: 16 }}>
        <label className="admin-notifications__label" htmlFor="syshealth-default-email">
          {t('notifAdminSysHealthDefaultEmail')}
        </label>
        <input
          id="syshealth-default-email"
          type="email"
          className="admin-notifications__input"
          value={defaultEmail}
          disabled={saving}
          onChange={(e) => setDefaultEmail(e.target.value)}
          placeholder="it-project@energi-up.com"
        />
        <p className="admin-notifications__hint">{t('notifAdminSysHealthDefaultEmailHint')}</p>
      </div>

      <h3 className="admin-notifications__sub" style={{ marginTop: 20 }}>
        {t('notifAdminSysHealthPerCheck')}
      </h3>
      <p className="admin-notifications__hint">{t('notifAdminSysHealthPerCheckHint')}</p>

      <table className="admin-notifications__syshealth-table">
        <thead>
          <tr>
            <th scope="col">{t('notifAdminSysHealthColCheck')}</th>
            <th scope="col">{t('notifAdminSysHealthColEmail')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = `${row.checkId}:${row.portId ?? ''}`
            return (
              <tr key={key}>
                <td>{row.title || row.checkId}</td>
                <td>
                  <input
                    type="email"
                    className="admin-notifications__input"
                    disabled={saving}
                    value={recipientEmails[key] ?? ''}
                    placeholder={t('notifAdminSysHealthOptionalEmail')}
                    onChange={(e) =>
                      setRecipientEmails((prev) => ({
                        ...prev,
                        [key]: e.target.value,
                      }))
                    }
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {enabled && !smtpConfigured ? (
        <p className="admin-notifications__hint admin-notifications__hint--warn" style={{ marginTop: 12 }}>
          {t('notifAdminSysHealthSmtpWarn')}
        </p>
      ) : null}

      {err ? <p className="admin-notifications__err">{err}</p> : null}

      <div style={{ marginTop: 16 }}>
        <button type="button" className="btn btn--primary btn--sm" disabled={saving} onClick={handleSave}>
          {saving ? t('notifAdminSaving') : t('notifAdminSysHealthSave')}
        </button>
      </div>
    </div>
  )
}