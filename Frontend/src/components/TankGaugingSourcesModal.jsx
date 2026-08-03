import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  createTankGaugingSource,
  deleteTankGaugingSource,
  fetchTankGaugingSources,
  testTankGaugingSource,
  updateTankGaugingSource,
} from '../api/tankGauging'
import '../styles/modal.css'

const EMPTY_FORM = {
  baseUrl: '',
  label: '',
  enabled: true,
  authType: 'none',
  authUser: '',
  authSecret: '',
}

function formatPollStatus(source, t) {
  if (!source.lastPollAt) return t('tankFarmSourcesPollNever')
  const at = new Date(source.lastPollAt)
  const time = Number.isNaN(at.getTime()) ? '—' : at.toLocaleString()
  if (source.lastPollOk === true) return t('tankFarmSourcesPollOk', { time })
  if (source.lastPollOk === false) {
    const err = source.lastError ? ` — ${source.lastError}` : ''
    return t('tankFarmSourcesPollError', { time, error: err })
  }
  return time
}

function authLabel(source, t) {
  if (source.authType === 'basic') {
    return source.authUser
      ? t('tankFarmSourcesAuthBasicUser', { user: source.authUser })
      : t('tankFarmSourcesAuthBasic')
  }
  if (source.authType === 'cookie') return t('tankFarmSourcesAuthCookie')
  return t('tankFarmSourcesAuthNone')
}

export default function TankGaugingSourcesModal({ portId, portName, onClose }) {
  const { t } = useTranslation('pages')
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  const loadSources = useCallback(async () => {
    if (!portId) {
      setSources([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const list = await fetchTankGaugingSources(portId)
      setSources(Array.isArray(list) ? list : [])
    } catch (e) {
      setSources([])
      setError(e?.message || t('tankFarmSourcesLoadFailed'))
    } finally {
      setLoading(false)
    }
  }, [portId, t])

  useEffect(() => {
    loadSources()
  }, [loadSources])

  useEffect(() => {
    if (!toast) return undefined
    const id = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(id)
  }, [toast])

  function openAdd() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  function openEdit(source) {
    setEditingId(source.id)
    setForm({
      baseUrl: source.baseUrl || '',
      label: source.label || '',
      enabled: Boolean(source.enabled),
      authType: source.authType || 'none',
      authUser: source.authUser || '',
      authSecret: '',
    })
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        portId,
        baseUrl: form.baseUrl.trim(),
        label: form.label.trim() || null,
        enabled: form.enabled,
        authType: form.authType,
        authUser: form.authType === 'basic' ? form.authUser.trim() : null,
      }
      if (form.authSecret.trim()) payload.authSecret = form.authSecret.trim()

      if (editingId) {
        await updateTankGaugingSource(editingId, payload)
        setToast({ variant: 'success', message: t('tankFarmSourcesSaved') })
      } else {
        if (form.authType !== 'none' && !form.authSecret.trim()) {
          setError(t('tankFarmSourcesSecretRequired'))
          return
        }
        await createTankGaugingSource(payload)
        setToast({ variant: 'success', message: t('tankFarmSourcesCreated') })
      }
      closeForm()
      await loadSources()
    } catch (e) {
      setError(e?.message || t('tankFarmSourcesSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleTest(source) {
    setTestingId(source.id)
    setError(null)
    try {
      const body = {}
      if (form.authSecret.trim() && editingId === source.id) {
        body.authSecret = form.authSecret.trim()
        body.authType = form.authType
        if (form.authType === 'basic') body.authUser = form.authUser.trim()
      }
      const result = await testTankGaugingSource(source.id, body)
      if (result.ok) {
        setToast({
          variant: 'success',
          message: t('tankFarmSourcesTestOk', { count: result.tankCount ?? 0 }),
        })
      } else {
        setToast({
          variant: 'error',
          message: result.error || t('tankFarmSourcesTestFailed'),
        })
      }
    } catch (e) {
      setToast({ variant: 'error', message: e?.message || t('tankFarmSourcesTestFailed') })
    } finally {
      setTestingId(null)
    }
  }

  async function handleDelete(source) {
    if (!window.confirm(t('tankFarmSourcesDeleteConfirm', { url: source.baseUrl }))) return
    setDeletingId(source.id)
    setError(null)
    try {
      await deleteTankGaugingSource(source.id)
      setToast({ variant: 'success', message: t('tankFarmSourcesDeleted') })
      if (editingId === source.id) closeForm()
      await loadSources()
    } catch (e) {
      setError(e?.message || t('tankFarmSourcesDeleteFailed'))
    } finally {
      setDeletingId(null)
    }
  }

  async function handleToggleEnabled(source) {
    try {
      await updateTankGaugingSource(source.id, { enabled: !source.enabled })
      await loadSources()
    } catch (e) {
      setError(e?.message || t('tankFarmSourcesSaveFailed'))
    }
  }

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="modal modal--wide modal--atg-sources"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tank-gauging-sources-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="tank-gauging-sources-title" className="modal__title">
          {t('tankFarmSourcesTitle', { port: portName || portId })}
        </h2>

        {toast ? (
          <div
            className={`toast ${toast.variant === 'error' ? 'toast--warning' : 'toast--success'}`}
            style={{ marginBottom: '0.75rem' }}
            role="status"
          >
            <span className="toast__icon" aria-hidden>{toast.variant === 'error' ? '!' : '✓'}</span>
            <p className="toast__message">{toast.message}</p>
            <button type="button" className="toast__close" onClick={() => setToast(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
        ) : null}

        {error ? (
          <p className="text-steel" style={{ color: 'var(--color-danger, #c00)' }} role="alert">
            {error}
          </p>
        ) : null}

        <div className="modal__body">
          {!showForm ? (
            <>
              <div className="tank-gauging-sources-modal__toolbar">
                <button type="button" className="btn btn--primary btn--small" onClick={openAdd}>
                  {t('tankFarmSourcesAdd')}
                </button>
              </div>

              {loading ? (
                <p className="text-steel">{t('tankFarmSourcesLoading')}</p>
              ) : sources.length === 0 ? (
                <p className="text-steel">{t('tankFarmSourcesEmpty')}</p>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t('tankFarmSourcesColLabel')}</th>
                        <th>{t('tankFarmSourcesColUrl')}</th>
                        <th>{t('tankFarmSourcesColAuth')}</th>
                        <th>{t('tankFarmSourcesColEnabled')}</th>
                        <th>{t('tankFarmSourcesColPoll')}</th>
                        <th>{t('tankFarmSourcesColActions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sources.map((s) => (
                        <tr key={s.id}>
                          <td>{s.label || '—'}</td>
                          <td>{s.baseUrl}</td>
                          <td>{authLabel(s, t)}</td>
                          <td>
                            <input
                              type="checkbox"
                              checked={Boolean(s.enabled)}
                              onChange={() => handleToggleEnabled(s)}
                              aria-label={t('tankFarmSourcesColEnabled')}
                            />
                          </td>
                          <td style={{ fontSize: '0.9em' }}>{formatPollStatus(s, t)}</td>
                          <td>
                            <div className="tank-gauging-sources-modal__row-actions">
                              <button
                                type="button"
                                className="btn btn--small btn--secondary"
                                onClick={() => openEdit(s)}
                              >
                                {t('tankFarmSourcesEdit')}
                              </button>
                              <button
                                type="button"
                                className="btn btn--small btn--secondary"
                                onClick={() => handleTest(s)}
                                disabled={testingId === s.id}
                              >
                                {testingId === s.id ? t('tankFarmSourcesTesting') : t('tankFarmSourcesTest')}
                              </button>
                              <button
                                type="button"
                                className="btn btn--small btn--secondary"
                                onClick={() => handleDelete(s)}
                                disabled={deletingId === s.id}
                              >
                                {t('tankFarmSourcesDelete')}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <>
              <h3 className="card__title" style={{ marginTop: 0 }}>
                {editingId ? t('tankFarmSourcesEditTitle') : t('tankFarmSourcesAddTitle')}
              </h3>
              <div className="modal__field">
                <label className="modal__label" htmlFor="atg-src-url">{t('tankFarmSourcesFieldUrl')}</label>
                <input
                  id="atg-src-url"
                  className="modal__input"
                  value={form.baseUrl}
                  onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                  placeholder="http://172.16.246.12"
                  autoComplete="off"
                />
              </div>
              <div className="modal__field">
                <label className="modal__label" htmlFor="atg-src-label">{t('tankFarmSourcesFieldLabel')}</label>
                <input
                  id="atg-src-label"
                  className="modal__input"
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                  autoComplete="off"
                />
              </div>
              <div className="modal__field">
                <label className="modal__label" htmlFor="atg-src-auth">{t('tankFarmSourcesFieldAuthType')}</label>
                <select
                  id="atg-src-auth"
                  className="modal__input"
                  value={form.authType}
                  onChange={(e) => setForm((f) => ({ ...f, authType: e.target.value }))}
                >
                  <option value="none">{t('tankFarmSourcesAuthNone')}</option>
                  <option value="basic">{t('tankFarmSourcesAuthBasic')}</option>
                  <option value="cookie">{t('tankFarmSourcesAuthCookie')}</option>
                </select>
              </div>
              {form.authType === 'basic' ? (
                <div className="modal__field">
                  <label className="modal__label" htmlFor="atg-src-user">{t('tankFarmSourcesFieldUser')}</label>
                  <input
                    id="atg-src-user"
                    className="modal__input"
                    value={form.authUser}
                    onChange={(e) => setForm((f) => ({ ...f, authUser: e.target.value }))}
                    autoComplete="off"
                  />
                </div>
              ) : null}
              {form.authType !== 'none' ? (
                <div className="modal__field">
                  <label className="modal__label" htmlFor="atg-src-secret">
                    {form.authType === 'cookie'
                      ? t('tankFarmSourcesFieldCookie')
                      : t('tankFarmSourcesFieldPassword')}
                  </label>
                  {form.authType === 'cookie' ? (
                    <textarea
                      id="atg-src-secret"
                      className="modal__input"
                      rows={3}
                      value={form.authSecret}
                      onChange={(e) => setForm((f) => ({ ...f, authSecret: e.target.value }))}
                      placeholder={editingId ? t('tankFarmSourcesSecretKeepBlank') : ''}
                    />
                  ) : (
                    <input
                      id="atg-src-secret"
                      type="password"
                      className="modal__input"
                      value={form.authSecret}
                      onChange={(e) => setForm((f) => ({ ...f, authSecret: e.target.value }))}
                      placeholder={editingId ? t('tankFarmSourcesSecretKeepBlank') : ''}
                      autoComplete="new-password"
                    />
                  )}
                </div>
              ) : null}
              <div className="modal__field">
                <label className="modal__label">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                  />{' '}
                  {t('tankFarmSourcesFieldEnabled')}
                </label>
              </div>
            </>
          )}
        </div>

        <div className="modal__actions">
          {showForm ? (
            <>
              <button type="button" className="btn btn--secondary btn--small" onClick={closeForm} disabled={saving}>
                {t('tankFarmSourcesCancel')}
              </button>
              <button
                type="button"
                className="btn btn--primary btn--small"
                onClick={handleSave}
                disabled={saving || !form.baseUrl.trim()}
              >
                {saving ? t('tankFarmSourcesSaving') : t('tankFarmSourcesSave')}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--secondary btn--small" onClick={onClose}>
              {t('tankFarmSourcesClose')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
