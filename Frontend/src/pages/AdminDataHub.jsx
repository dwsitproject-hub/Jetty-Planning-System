import { useState, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchDataHubConfig, saveDataHubConfig, testDataHubConnection } from '../api/datahubAdmin'
import '../styles/allocation.css'
import '../styles/modal.css'
import '../styles/admin.css'

function formatWhen(value) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

export default function AdminDataHub() {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(null)
  const [toast, setToast] = useState(null)

  const [baseUrl, setBaseUrl] = useState('')
  const [publicKey, setPublicKey] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const applyConfig = useCallback((cfg) => {
    setConfig(cfg)
    setBaseUrl(cfg?.baseUrl || '')
    setPublicKey(cfg?.publicKey || '')
    setPrivateKey('')
    setEnabled(cfg?.enabled === true)
  }, [])

  const load = useCallback(async () => {
    setLoadErr(null)
    setLoading(true)
    try {
      applyConfig(await fetchDataHubConfig())
    } catch (e) {
      setLoadErr(e?.message || 'Failed to load DataHub settings (sign in as admin?)')
    } finally {
      setLoading(false)
    }
  }, [applyConfig])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setTestResult(null)
    try {
      applyConfig(await saveDataHubConfig({ baseUrl, publicKey, privateKey, enabled }))
      setToast({ kind: 'success', text: 'DataHub settings saved.' })
    } catch (e) {
      setToast({ kind: 'error', text: e?.message || 'Save failed' })
    } finally {
      setSaving(false)
    }
  }, [baseUrl, publicKey, privateKey, enabled, applyConfig])

  const handleTest = useCallback(async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testDataHubConnection({ baseUrl, publicKey, privateKey })
      setTestResult({ ok: true, text: result?.message || 'Connection OK.' })
    } catch (e) {
      setTestResult({
        ok: false,
        text: e?.message || 'Connection failed',
        hint: e?.body?.hint || null,
      })
    } finally {
      setTesting(false)
    }
  }, [baseUrl, publicKey, privateKey])

  return (
    <div className="allocation-page">
      <h1 className="page-title">DataHub Integration</h1>
      <p className="allocation-page__intro">
        <Link to="/admin" className="link">← Back to Admin</Link>
      </p>
      <p className="text-steel" style={{ marginTop: 0 }}>
        Credentials JPS uses to read master data from DataHub (DHM). Register an application on the
        DataHub <code>/integrations</code> page to get a key pair, and make sure the{' '}
        <code>vessel</code> entity is allowlisted for it. These settings drive{' '}
        <Link to="/master/vessel" className="link">Master – Vessel</Link>.
      </p>

      {toast && (
        <div
          className={`toast ${toast.kind === 'error' ? 'toast--error' : 'toast--success'}`}
          role="status"
          aria-live="polite"
          style={{ marginTop: 12 }}
        >
          {toast.text}
        </div>
      )}
      {loadErr && <p style={{ color: '#c00' }}>{loadErr}</p>}

      <section className="card at-berth-list-section">
        <div className="card__header-row">
          <h2 className="card__title">Status</h2>
          <button type="button" className="btn btn--secondary btn--small" onClick={load} disabled={loading}>
            Refresh
          </button>
        </div>
        {loading ? (
          <p className="text-steel">Loading…</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table allocation-table">
              <tbody>
                <tr className="allocation-table__row">
                  <th scope="row" style={{ textAlign: 'left' }}>Integration</th>
                  <td>
                    <span
                      className={
                        config?.enabled
                          ? 'admin-status-badge admin-status-badge--active'
                          : 'admin-status-badge admin-status-badge--inactive'
                      }
                    >
                      {config?.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                </tr>
                <tr className="allocation-table__row">
                  <th scope="row" style={{ textAlign: 'left' }}>Key pair</th>
                  <td className="text-steel">
                    {config?.privateKeyConfigured ? 'Stored' : 'Not configured'}
                  </td>
                </tr>
                <tr className="allocation-table__row">
                  <th scope="row" style={{ textAlign: 'left' }}>Settings source</th>
                  <td className="text-steel">
                    {config?.source === 'database'
                      ? 'Database (this page)'
                      : config?.source === 'environment'
                        ? 'Environment variables (DHM_* in Backend/.env)'
                        : 'None'}
                  </td>
                </tr>
                <tr className="allocation-table__row">
                  <th scope="row" style={{ textAlign: 'left' }}>Last hub read</th>
                  <td className="text-steel">
                    {formatWhen(config?.lastSyncAt)}
                    {config?.lastSyncAt != null && config?.lastSyncOk != null
                      ? config.lastSyncOk
                        ? ' — OK'
                        : ' — failed'
                      : ''}
                  </td>
                </tr>
                {config?.lastError && (
                  <tr className="allocation-table__row">
                    <th scope="row" style={{ textAlign: 'left' }}>Last error</th>
                    <td style={{ color: '#c00' }}>{config.lastError}</td>
                  </tr>
                )}
                <tr className="allocation-table__row">
                  <th scope="row" style={{ textAlign: 'left' }}>Settings updated</th>
                  <td className="text-steel">{formatWhen(config?.updatedAt)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card at-berth-list-section">
        <div className="card__header-row">
          <h2 className="card__title">Credentials</h2>
        </div>
        <div className="modal__section" style={{ maxWidth: '46rem' }}>
          <label htmlFor="dhm-base-url" className="modal__label">API base URL</label>
          <input
            id="dhm-base-url"
            type="text"
            className="modal__input"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://datahub.example.com"
            disabled={saving || loading}
          />
          <p className="text-steel" style={{ marginTop: '0.25rem', fontSize: '0.85em' }}>
            Host of the DataHub <code>/v1</code> API, without the <code>/v1</code> suffix. This is not
            the portal URL.
          </p>

          <label htmlFor="dhm-public-key" className="modal__label" style={{ marginTop: '0.75rem' }}>
            Public key
          </label>
          <input
            id="dhm-public-key"
            type="text"
            className="modal__input"
            value={publicKey}
            onChange={(e) => setPublicKey(e.target.value)}
            placeholder="dhm_pk_…"
            disabled={saving || loading}
            autoComplete="off"
          />

          <label htmlFor="dhm-private-key" className="modal__label" style={{ marginTop: '0.75rem' }}>
            Private key
          </label>
          <input
            id="dhm-private-key"
            type="password"
            className="modal__input"
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            placeholder={config?.privateKeyConfigured ? 'Stored — leave blank to keep' : 'dhm_sk_…'}
            disabled={saving || loading}
            autoComplete="new-password"
          />
          <p className="text-steel" style={{ marginTop: '0.25rem', fontSize: '0.85em' }}>
            Write-only: the stored key is encrypted and never shown again. Leave blank to keep the
            current one.
          </p>

          <label
            htmlFor="dhm-enabled"
            className="modal__checkbox-label"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem' }}
          >
            <input
              id="dhm-enabled"
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={saving || loading}
            />
            Enable DataHub sync
          </label>
          <p className="text-steel" style={{ marginTop: '0.25rem', fontSize: '0.85em' }}>
            While disabled, Sync from DataHub on Master – Vessel is refused.
          </p>

          {testResult && (
            <p
              style={{ marginTop: '0.75rem', color: testResult.ok ? 'var(--color-success, #0a7)' : '#c00' }}
              role="status"
            >
              {testResult.text}
              {testResult.hint ? ` ${testResult.hint}` : ''}
            </p>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={handleTest}
              disabled={testing || saving || loading}
            >
              {testing ? 'Testing…' : 'Test connection'}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleSave}
              disabled={saving || testing || loading}
            >
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
          <p className="text-steel" style={{ marginTop: '0.5rem', fontSize: '0.85em' }}>
            Test connection uses whatever is in the form, falling back to the stored values, so you
            can verify a key pair before saving it.
          </p>
        </div>
      </section>
    </div>
  )
}
