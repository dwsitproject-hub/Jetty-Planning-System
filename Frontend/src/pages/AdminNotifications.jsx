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
  fetchSmtpStatus,
  sendSmtpTestEmail,
} from '../api/notificationAdmin'
import { fetchUsers } from '../api/usersApi'
import { fetchRoles } from '../api/rbac'
import { fetchPorts } from '../api/ports'
import DropdownMultiSelect from '../components/DropdownMultiSelect'
import '../styles/allocation.css'
import '../styles/admin.css'

const WORKFLOW_EVENTS = ['shipment_plan.submitted', 'operation.signoff_requested']
const SLA_EVENTS = ['operation.sla_etc_d1', 'operation.sla_etc_breach']
const ADMIN_EVENT_DISPLAY_ORDER = [...WORKFLOW_EVENTS, ...SLA_EVENTS]
const COLLAPSE_STORAGE_KEY = 'jps_admin_notifications_collapsed'

function defaultCollapsedState() {
  const out = {}
  for (const ek of ADMIN_EVENT_DISPLAY_ORDER) {
    out[ek] = !(ek === 'shipment_plan.submitted')
  }
  return out
}

function readCollapsedState() {
  try {
    const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY)
    if (!raw) return defaultCollapsedState()
    const parsed = JSON.parse(raw)
    return { ...defaultCollapsedState(), ...parsed }
  } catch {
    return defaultCollapsedState()
  }
}

function writeCollapsedState(state) {
  try {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

function CollapsiblePanel({ panelId, title, summary, expanded, onToggle, children, t }) {
  const bodyId = `${panelId}-body`
  return (
    <section className="card admin-notifications__card admin-notifications__collapsible">
      <div className="admin-notifications__card-head admin-notifications__collapsible-head">
        <button
          type="button"
          className="admin-notifications__collapsible-trigger"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <span className="admin-notifications__collapsible-chevron" aria-hidden>
            {expanded ? '▾' : '▸'}
          </span>
          <h2 className="admin-notifications__card-title">{title}</h2>
        </button>
        {summary && <div className="admin-notifications__collapsible-summary">{summary}</div>}
        <span className="visually-hidden">
          {expanded ? t('notifAdminCollapseSection') : t('notifAdminExpandSection')}
        </span>
      </div>
      {expanded && (
        <div id={bodyId} className="admin-notifications__collapsible-body">
          {children}
        </div>
      )}
    </section>
  )
}

const EVENT_LABEL_FALLBACK = {
  'shipment_plan.submitted': 'Shipment Plan Approval',
  'operation.signoff_requested': 'Clearance Sign Off Request',
  'operation.sla_etc_d1': 'SLA D-1 Reminder',
  'operation.sla_etc_breach': 'SLA Breach Alert',
}

function orderEvents(apiEvents) {
  const byKey = Object.fromEntries((apiEvents || []).map((e) => [e.eventKey, e]))
  return ADMIN_EVENT_DISPLAY_ORDER.map((ek) => {
    const row = byKey[ek]
    if (row) return row
    return {
      eventKey: ek,
      label: EVENT_LABEL_FALLBACK[ek] || ek,
      enabled: true,
      inAppEnabled: true,
      emailEnabled: true,
      includePostSignoffBreach: false,
      dailySendHour: 8,
      recipientCount: 0,
    }
  })
}

function renderTemplatePreview(template, vars) {
  if (template == null) return ''
  const v = vars && typeof vars === 'object' ? vars : {}
  return String(template).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key) => {
    const k = String(key).trim()
    const val = v[k]
    return val == null ? '' : String(val)
  })
}

function EventCard({
  event,
  recipients,
  emailTemplate,
  showEmailTemplate,
  isWorkflow,
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

  const noRecipientsHint = isWorkflow ? t('notifAdminNoRecipientsWorkflow') : t('notifAdminNoRecipients')

  return (
    <>
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
      {isWorkflow && event.enabled && (recipients || []).length === 0 && (
        <p className="admin-notifications__hint admin-notifications__hint--warn">{t('notifAdminNoRecipientsWarn')}</p>
      )}
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
      {showEmailTemplate && (
        <>
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
        </>
      )}
      <h3 className="admin-notifications__sub">{t('notifAdminRecipients')}</h3>
      <ul className="admin-notifications__recipient-list">
        {(recipients || []).length === 0 ? (
          <li className="admin-notifications__empty">{noRecipientsHint}</li>
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
    </>
  )
}

function eventPanelSummary(event, recipients, t) {
  const recCount = (recipients || []).length
  return (
    <>
      <span className={`admin-notifications__badge ${event.enabled ? '' : 'admin-notifications__badge--muted'}`}>
        {event.enabled ? t('notifAdminEnabled') : 'Off'}
      </span>
      {event.enabled && (
        <>
          <span className="admin-notifications__badge admin-notifications__badge--muted">
            {event.inAppEnabled ? t('notifAdminInApp') : 'In-app off'}
          </span>
          <span className="admin-notifications__badge admin-notifications__badge--muted">
            {event.emailEnabled ? t('notifAdminEmail') : 'Email off'}
          </span>
        </>
      )}
      <span className="admin-notifications__badge admin-notifications__badge--muted">
        {t('notifAdminRecipientCount', { count: recCount })}
      </span>
    </>
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
  const [smtpStatus, setSmtpStatus] = useState(null)
  const [smtpTesting, setSmtpTesting] = useState(false)
  const [toast, setToast] = useState(null)
  const [collapsed, setCollapsed] = useState(() => readCollapsedState())

  const toggleCollapsed = (key) => {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      writeCollapsedState(next)
      return next
    })
  }

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const [ev, u, ro, po, smStatus] = await Promise.all([
        fetchNotificationEvents(),
        fetchUsers(),
        fetchRoles(),
        fetchPorts(),
        fetchSmtpStatus(),
      ])
      setEvents(orderEvents(Array.isArray(ev) ? ev : []))
      setUsers(Array.isArray(u) ? u : [])
      setRoles(Array.isArray(ro) ? ro : [])
      setPorts(Array.isArray(po) ? po : [])
      setSmtpStatus(smStatus)
      const [recPairs, tplPairs] = await Promise.all([
        Promise.all(
          ADMIN_EVENT_DISPLAY_ORDER.map(async (ek) => [ek, await fetchEventRecipients(ek)])
        ),
        Promise.all(
          ADMIN_EVENT_DISPLAY_ORDER.map(async (ek) => [ek, await fetchEventEmailTemplate(ek)])
        ),
      ])
      setRecipientsByEvent(Object.fromEntries(recPairs))
      setTemplatesByEvent(Object.fromEntries(tplPairs))
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
        <div className="admin-notifications__header-actions">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={smtpTesting || !smtpStatus?.configured}
            onClick={testSmtp}
          >
            {smtpTesting ? t('notifAdminTesting') : t('notifAdminSendTest')}
          </button>
          <Link to="/admin/notifications/email-log" className="btn btn--secondary btn--sm">
            {t('notifAdminViewEmailLog')}
          </Link>
        </div>
      </div>

      {toast && (
        <p className={`admin-notifications__toast admin-notifications__toast--${toast.kind}`}>{toast.text}</p>
      )}
      {err && <p className="admin-notifications__err">{err}</p>}
      {!loading && smtpStatus && !smtpStatus.configured && (
        <p className="admin-notifications__warn">{t('notifAdminSmtpEnvMissing')}</p>
      )}
      {!loading && smtpStatus?.configured && (
        <p className="admin-notifications__env-hint">{t('notifAdminSmtpEnvHint')}</p>
      )}
      {loading ? (
        <p>{t('notifAdminLoading')}</p>
      ) : (
        <>
          {events.map((event) => (
            <CollapsiblePanel
              key={event.eventKey}
              panelId={`admin-notif-${event.eventKey}`}
              title={event.label || event.eventKey}
              summary={eventPanelSummary(event, recipientsByEvent[event.eventKey], t)}
              expanded={!collapsed[event.eventKey]}
              onToggle={() => toggleCollapsed(event.eventKey)}
              t={t}
            >
              <EventCard
                event={event}
                recipients={recipientsByEvent[event.eventKey] || []}
                emailTemplate={templatesByEvent[event.eventKey]}
                showEmailTemplate
                isWorkflow={WORKFLOW_EVENTS.includes(event.eventKey)}
                onTemplateSaved={(saved, message) => handleTemplateSaved(event.eventKey, saved, message)}
                onTemplateTestOk={handleTemplateTestOk}
                users={users}
                roles={roles}
                ports={ports}
                onRefresh={load}
                t={t}
              />
            </CollapsiblePanel>
          ))}
        </>
      )}
    </div>
  )
}
