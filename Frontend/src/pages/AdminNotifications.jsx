import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  fetchNotificationEvents,
  updateNotificationEvent,
  fetchEventRecipients,
  addEventRecipient,
  removeEventRecipient,
  fetchEventEmailTemplate,
  saveEventEmailTemplate,
  resetEventEmailTemplate,
  sendEventEmailTemplateTest,
  fetchSmtpConfig,
  saveSmtpConfig,
  sendSmtpTestEmail,
} from '../api/notificationAdmin'
import { fetchUsers } from '../api/usersApi'
import { fetchRoles } from '../api/rbac'
import { fetchPorts } from '../api/ports'
import DropdownMultiSelect from '../components/DropdownMultiSelect'
import '../styles/allocation.css'
import '../styles/admin.css'

const SLA_EVENTS = ['operation.sla_etc_d1', 'operation.sla_etc_breach']

function renderTemplatePreview(template, vars) {
  if (template == null) return ''
  const v = vars && typeof vars === 'object' ? vars : {}
  return String(template).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key) => {
    const k = String(key).trim()
    const val = v[k]
    return val == null ? '' : String(val)
  })
}

function smtpStatusLabel(cfg, t) {
  if (!cfg) return t('notifAdminSmtpNotConfigured')
  if (cfg.enabled && cfg.passwordConfigured) return t('notifAdminSmtpDatabase')
  if (cfg.source === 'environment') return t('notifAdminSmtpEnvironment')
  if (cfg.enabled) return t('notifAdminSmtpPartial')
  return t('notifAdminSmtpNotConfigured')
}

function EventCard({
  event,
  recipients,
  emailTemplate,
  onTemplateSaved,
  onTemplateTestOk,
  users,
  roles,
  ports,
  onRefresh,
  t,
}) {
  const [saving, setSaving] = useState(false)
  const [tplSaving, setTplSaving] = useState(false)
  const [tplTesting, setTplTesting] = useState(false)
  const [tplForm, setTplForm] = useState({ titleTemplate: '', bodyTemplate: '' })
  const [addKind, setAddKind] = useState('user')
  const [addUserId, setAddUserId] = useState('')
  const [addRoleId, setAddRoleId] = useState('')
  const [addPortIds, setAddPortIds] = useState([])
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (emailTemplate) {
      setTplForm({
        titleTemplate: emailTemplate.titleTemplate || '',
        bodyTemplate: emailTemplate.bodyTemplate || '',
      })
    }
  }, [emailTemplate])

  const saveSettings = async (patch) => {
    setSaving(true)
    setErr(null)
    try {
      await updateNotificationEvent(event.eventKey, patch)
      await onRefresh()
    } catch (e) {
      setErr(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const portOptions = (ports || []).map((p) => ({
    value: String(p.id),
    label: p.name,
  }))

  const handleAddRecipient = async () => {
    setErr(null)
    try {
      const body =
        addKind === 'user'
          ? { userId: Number(addUserId), portIds: addPortIds.map(Number) }
          : { roleId: Number(addRoleId), portIds: addPortIds.map(Number) }
      await addEventRecipient(event.eventKey, body)
      setAddUserId('')
      setAddRoleId('')
      setAddPortIds([])
      await onRefresh()
    } catch (e) {
      setErr(e?.message || 'Add failed')
    }
  }

  const handleRemove = async (id) => {
    if (!window.confirm(t('notifAdminRemoveRecipientConfirm'))) return
    try {
      await removeEventRecipient(id)
      await onRefresh()
    } catch (e) {
      setErr(e?.message || 'Remove failed')
    }
  }

  const saveTemplate = async () => {
    setTplSaving(true)
    setErr(null)
    try {
      const saved = await saveEventEmailTemplate(event.eventKey, tplForm)
      onTemplateSaved?.(saved, t('notifAdminTemplateSaved'))
    } catch (e) {
      setErr(e?.message || 'Save failed')
    } finally {
      setTplSaving(false)
    }
  }

  const resetTemplate = async () => {
    if (!window.confirm(t('notifAdminTemplateResetConfirm'))) return
    setTplSaving(true)
    setErr(null)
    try {
      const saved = await resetEventEmailTemplate(event.eventKey)
      onTemplateSaved?.(saved, t('notifAdminTemplateResetOk'))
    } catch (e) {
      setErr(e?.message || 'Reset failed')
    } finally {
      setTplSaving(false)
    }
  }

  const testTemplate = async () => {
    setTplTesting(true)
    setErr(null)
    try {
      const result = await sendEventEmailTemplateTest(event.eventKey, tplForm)
      onTemplateTestOk?.(result.to, t('notifAdminTemplateTestOk', { to: result.to }))
    } catch (e) {
      setErr(e?.message || 'Test failed')
    } finally {
      setTplTesting(false)
    }
  }

  const isBreach = event.eventKey === 'operation.sla_etc_breach'
  const placeholders = emailTemplate?.placeholders || []
  const previewVars = emailTemplate?.samplePreviewVars || {}
  const savedSubject = emailTemplate?.titleTemplate || ''
  const savedBody = emailTemplate?.bodyTemplate || ''
  const hasUnsavedTemplate =
    tplForm.titleTemplate !== savedSubject || tplForm.bodyTemplate !== savedBody
  const previewSubject = renderTemplatePreview(tplForm.titleTemplate, previewVars)
  const previewBody = renderTemplatePreview(tplForm.bodyTemplate, previewVars)

  return (
    <section className="card admin-notifications__card">
      <h2 className="admin-notifications__card-title">{event.label || event.eventKey}</h2>
      {err && <p className="admin-notifications__err">{err}</p>}
      <div className="admin-notifications__toggles">
        <label className="admin-notifications__toggle">
          <input
            type="checkbox"
            checked={Boolean(event.enabled)}
            disabled={saving}
            onChange={(e) => saveSettings({ enabled: e.target.checked })}
          />
          {t('notifAdminEnabled')}
        </label>
        <label className="admin-notifications__toggle">
          <input
            type="checkbox"
            checked={Boolean(event.inAppEnabled)}
            disabled={saving || !event.enabled}
            onChange={(e) => saveSettings({ inAppEnabled: e.target.checked })}
          />
          {t('notifAdminInApp')}
        </label>
        <label className="admin-notifications__toggle">
          <input
            type="checkbox"
            checked={Boolean(event.emailEnabled)}
            disabled={saving || !event.enabled}
            onChange={(e) => saveSettings({ emailEnabled: e.target.checked })}
          />
          {t('notifAdminEmail')}
        </label>
      </div>
      {isBreach && (
        <>
          <label className="admin-notifications__field">
            <span>{t('notifAdminDailyHour')}</span>
            <input
              type="number"
              min={0}
              max={23}
              value={event.dailySendHour ?? 8}
              disabled={saving}
              onChange={(e) => saveSettings({ dailySendHour: Number(e.target.value) })}
            />
          </label>
          <label className="admin-notifications__toggle">
            <input
              type="checkbox"
              checked={Boolean(event.includePostSignoffBreach)}
              disabled={saving}
              onChange={(e) => saveSettings({ includePostSignoffBreach: e.target.checked })}
            />
            {t('notifAdminIncludePostSignoff')}
          </label>
        </>
      )}
      <h3 className="admin-notifications__sub">{t('notifAdminEmailTemplate')}</h3>
      <p className="admin-notifications__hint">{t('notifAdminEmailTemplateHint')}</p>
      <div className="admin-notifications__current-template">
        <span className="admin-notifications__preview-label">{t('notifAdminTemplateCurrent')}</span>
        {emailTemplate?.isDefault && (
          <span className="admin-notifications__badge admin-notifications__badge--muted">
            {t('notifAdminTemplateDefaultBadge')}
          </span>
        )}
        <div className="admin-notifications__preview-box admin-notifications__preview-box--current">
          <div className="admin-notifications__current-row">
            <span className="admin-notifications__current-key">{t('notifAdminTemplateSubject')}</span>
            <pre>{savedSubject || '—'}</pre>
          </div>
          <div className="admin-notifications__current-row">
            <span className="admin-notifications__current-key">{t('notifAdminTemplateBody')}</span>
            <pre>{savedBody || '—'}</pre>
          </div>
        </div>
      </div>
      <h4 className="admin-notifications__sub admin-notifications__sub--inline">{t('notifAdminTemplateEdit')}</h4>
      {hasUnsavedTemplate && (
        <p className="admin-notifications__hint admin-notifications__hint--warn">{t('notifAdminTemplateUnsaved')}</p>
      )}
      <label className="admin-notifications__field">
        <span>{t('notifAdminTemplateSubject')}</span>
        <input
          value={tplForm.titleTemplate}
          disabled={tplSaving}
          onChange={(e) => setTplForm((f) => ({ ...f, titleTemplate: e.target.value }))}
        />
      </label>
      <label className="admin-notifications__field">
        <span>{t('notifAdminTemplateBody')}</span>
        <textarea
          className="admin-notifications__template-body"
          rows={10}
          value={tplForm.bodyTemplate}
          disabled={tplSaving}
          onChange={(e) => setTplForm((f) => ({ ...f, bodyTemplate: e.target.value }))}
        />
      </label>
      {placeholders.length > 0 && (
        <div className="admin-notifications__placeholders">
          <span className="admin-notifications__placeholders-label">{t('notifAdminTemplatePlaceholders')}</span>
          {placeholders.map((ph) => (
            <code key={ph} className="admin-notifications__placeholder-chip">{`{{${ph}}}`}</code>
          ))}
        </div>
      )}
      <div className="admin-notifications__preview">
        <span className="admin-notifications__preview-label">{t('notifAdminTemplatePreview')}</span>
        <div className="admin-notifications__preview-box">
          <strong>{previewSubject || '—'}</strong>
          <pre>{previewBody || '—'}</pre>
        </div>
      </div>
      <div className="admin-notifications__actions">
        <button type="button" className="btn btn--primary btn--sm" disabled={tplSaving} onClick={saveTemplate}>
          {tplSaving ? t('notifAdminSaving') : t('notifAdminTemplateSave')}
        </button>
        <button type="button" className="btn btn--secondary btn--sm" disabled={tplSaving} onClick={resetTemplate}>
          {t('notifAdminTemplateReset')}
        </button>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          disabled={tplSaving || tplTesting}
          onClick={testTemplate}
        >
          {tplTesting ? t('notifAdminTesting') : t('notifAdminTemplateSendTest')}
        </button>
      </div>
      <h3 className="admin-notifications__sub">{t('notifAdminRecipients')}</h3>
      <ul className="admin-notifications__recipient-list">
        {(recipients || []).length === 0 ? (
          <li className="admin-notifications__empty">{t('notifAdminNoRecipients')}</li>
        ) : (
          recipients.map((r) => (
            <li key={r.id} className="admin-notifications__recipient-item">
              <span>{r.label}</span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => handleRemove(r.id)}>
                {t('notifAdminRemove')}
              </button>
            </li>
          ))
        )}
      </ul>
      <div className="admin-notifications__add-recipient">
        <select value={addKind} onChange={(e) => setAddKind(e.target.value)}>
          <option value="user">{t('notifAdminAddUser')}</option>
          <option value="role">{t('notifAdminAddRole')}</option>
        </select>
        {addKind === 'user' ? (
          <select value={addUserId} onChange={(e) => setAddUserId(e.target.value)}>
            <option value="">{t('notifAdminSelectUser')}</option>
            {(users || []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.username} {u.email ? `(${u.email})` : ''}
              </option>
            ))}
          </select>
        ) : (
          <select value={addRoleId} onChange={(e) => setAddRoleId(e.target.value)}>
            <option value="">{t('notifAdminSelectRole')}</option>
            {(roles || []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}
        <DropdownMultiSelect
          id={`${event.eventKey}-ports`}
          label={t('notifAdminSelectPorts')}
          placeholder={t('notifAdminPortsPlaceholder')}
          titleLabel={t('notifAdminPortsTitle')}
          options={portOptions}
          selectedValues={addPortIds}
          onChange={setAddPortIds}
          className="admin-notifications__port-dropdown dropdown-multi"
          emptyText={t('notifAdminNoPorts')}
        />
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={handleAddRecipient}
          disabled={addKind === 'user' ? !addUserId : !addRoleId}
        >
          {t('notifAdminAddRecipient')}
        </button>
      </div>
    </section>
  )
}

export default function AdminNotifications() {
  const { t } = useTranslation('pages')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [events, setEvents] = useState([])
  const [recipientsByEvent, setRecipientsByEvent] = useState({})
  const [templatesByEvent, setTemplatesByEvent] = useState({})
  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [ports, setPorts] = useState([])
  const [smtp, setSmtp] = useState(null)
  const [smtpForm, setSmtpForm] = useState({
    host: '',
    port: 465,
    secure: true,
    user: '',
    password: '',
    fromAddress: '',
    rejectUnauthorized: true,
    enabled: false,
  })
  const [smtpSaving, setSmtpSaving] = useState(false)
  const [smtpTesting, setSmtpTesting] = useState(false)
  const [toast, setToast] = useState(null)

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const [ev, u, ro, po, sm] = await Promise.all([
        fetchNotificationEvents(),
        fetchUsers(),
        fetchRoles(),
        fetchPorts(),
        fetchSmtpConfig(),
      ])
      setEvents(Array.isArray(ev) ? ev.filter((e) => SLA_EVENTS.includes(e.eventKey)) : [])
      setUsers(Array.isArray(u) ? u : [])
      setRoles(Array.isArray(ro) ? ro : [])
      setPorts(Array.isArray(po) ? po : [])
      setSmtp(sm)
      setSmtpForm({
        host: sm?.host || '',
        port: sm?.port ?? 465,
        secure: sm?.secure !== false,
        user: sm?.user || '',
        password: '',
        fromAddress: sm?.fromAddress || sm?.user || '',
        rejectUnauthorized: sm?.rejectUnauthorized !== false,
        enabled: Boolean(sm?.enabled),
      })
      const rec = {}
      const tpl = {}
      for (const ek of SLA_EVENTS) {
        rec[ek] = await fetchEventRecipients(ek)
        tpl[ek] = await fetchEventEmailTemplate(ek)
      }
      setRecipientsByEvent(rec)
      setTemplatesByEvent(tpl)
    } catch (e) {
      setErr(e?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const saveSmtp = async () => {
    setSmtpSaving(true)
    try {
      const saved = await saveSmtpConfig({
        host: smtpForm.host,
        port: Number(smtpForm.port),
        secure: smtpForm.secure,
        user: smtpForm.user,
        password: smtpForm.password || undefined,
        fromAddress: smtpForm.fromAddress || smtpForm.user,
        rejectUnauthorized: smtpForm.rejectUnauthorized,
        enabled: smtpForm.enabled,
      })
      setSmtp(saved)
      setSmtpForm((f) => ({ ...f, password: '' }))
      setToast({ kind: 'success', text: t('notifAdminSmtpSaved') })
    } catch (e) {
      setToast({ kind: 'error', text: e?.message || 'Save failed' })
    } finally {
      setSmtpSaving(false)
    }
  }

  const testSmtp = async () => {
    setSmtpTesting(true)
    try {
      const r = await sendSmtpTestEmail()
      setToast({ kind: 'success', text: t('notifAdminSmtpTestOk', { to: r.to }) })
    } catch (e) {
      setToast({ kind: 'error', text: e?.message || 'Test failed' })
    } finally {
      setSmtpTesting(false)
    }
  }

  const handleTemplateSaved = (eventKey, saved, message) => {
    setTemplatesByEvent((prev) => ({ ...prev, [eventKey]: saved }))
    setToast({ kind: 'success', text: message })
  }

  const handleTemplateTestOk = (to, message) => {
    setToast({ kind: 'success', text: message || t('notifAdminTemplateTestOk', { to }) })
  }

  return (
    <div className="allocation-page admin-notifications">
      <div className="admin-notifications__header">
        <div>
          <Link to="/admin" className="admin-notifications__back">
            ← {t('admin')}
          </Link>
          <h1 className="page-title">{t('adminHubNotificationsTitle')}</h1>
          <p className="allocation-page__intro">{t('adminHubNotificationsDesc')}</p>
        </div>
        <Link to="/admin/notifications/email-log" className="btn btn--secondary">
          {t('notifAdminViewEmailLog')}
        </Link>
      </div>

      {toast && (
        <p className={`admin-notifications__toast admin-notifications__toast--${toast.kind}`}>{toast.text}</p>
      )}
      {err && <p className="admin-notifications__err">{err}</p>}
      {loading ? (
        <p>{t('notifAdminLoading')}</p>
      ) : (
        <>
          <section className="card admin-notifications__card">
            <div className="admin-notifications__card-head">
              <h2 className="admin-notifications__card-title">{t('notifAdminSmtpTitle')}</h2>
              <span className="admin-notifications__badge">{smtpStatusLabel(smtp, t)}</span>
            </div>
            <label className="admin-notifications__toggle">
              <input
                type="checkbox"
                checked={smtpForm.enabled}
                onChange={(e) => setSmtpForm((f) => ({ ...f, enabled: e.target.checked }))}
              />
              {t('notifAdminSmtpEnableDb')}
            </label>
            <div className="admin-notifications__grid">
              <label className="admin-notifications__field">
                <span>{t('notifAdminSmtpHost')}</span>
                <input
                  value={smtpForm.host}
                  onChange={(e) => setSmtpForm((f) => ({ ...f, host: e.target.value }))}
                  placeholder="mail.example.com"
                />
              </label>
              <label className="admin-notifications__field">
                <span>{t('notifAdminSmtpPort')}</span>
                <input
                  type="number"
                  value={smtpForm.port}
                  onChange={(e) => setSmtpForm((f) => ({ ...f, port: e.target.value }))}
                />
              </label>
              <label className="admin-notifications__field">
                <span>{t('notifAdminSmtpUser')}</span>
                <input
                  value={smtpForm.user}
                  onChange={(e) => setSmtpForm((f) => ({ ...f, user: e.target.value }))}
                />
              </label>
              <label className="admin-notifications__field">
                <span>{t('notifAdminSmtpPassword')}</span>
                <input
                  type="password"
                  value={smtpForm.password}
                  placeholder={smtp?.passwordConfigured ? t('notifAdminSmtpPasswordKeep') : ''}
                  onChange={(e) => setSmtpForm((f) => ({ ...f, password: e.target.value }))}
                />
              </label>
              <label className="admin-notifications__field">
                <span>{t('notifAdminSmtpFrom')}</span>
                <input
                  value={smtpForm.fromAddress}
                  onChange={(e) => setSmtpForm((f) => ({ ...f, fromAddress: e.target.value }))}
                />
              </label>
            </div>
            <label className="admin-notifications__toggle">
              <input
                type="checkbox"
                checked={smtpForm.secure}
                onChange={(e) => setSmtpForm((f) => ({ ...f, secure: e.target.checked }))}
              />
              {t('notifAdminSmtpSsl')}
            </label>
            <label className="admin-notifications__toggle">
              <input
                type="checkbox"
                checked={smtpForm.rejectUnauthorized}
                onChange={(e) => setSmtpForm((f) => ({ ...f, rejectUnauthorized: e.target.checked }))}
              />
              {t('notifAdminSmtpRejectUnauthorized')}
            </label>
            <div className="admin-notifications__actions">
              <button type="button" className="btn btn--primary" disabled={smtpSaving} onClick={saveSmtp}>
                {smtpSaving ? t('notifAdminSaving') : t('notifAdminSave')}
              </button>
              <button type="button" className="btn btn--secondary" disabled={smtpTesting} onClick={testSmtp}>
                {smtpTesting ? t('notifAdminTesting') : t('notifAdminSendTest')}
              </button>
            </div>
          </section>

          {events.map((event) => (
            <EventCard
              key={event.eventKey}
              event={event}
              recipients={recipientsByEvent[event.eventKey] || []}
              emailTemplate={templatesByEvent[event.eventKey]}
              onTemplateSaved={(saved, message) => handleTemplateSaved(event.eventKey, saved, message)}
              onTemplateTestOk={handleTemplateTestOk}
              users={users}
              roles={roles}
              ports={ports}
              onRefresh={load}
              t={t}
            />
          ))}
        </>
      )}
    </div>
  )
}
