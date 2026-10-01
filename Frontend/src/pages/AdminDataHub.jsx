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
  const [webhookEnabled, setWebhookEnabled] = useState(false)
  const [webhookAutoApply, setWebhookAutoApply] = useState(false)
  const [webhookSecret, setWebhookSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const applyConfig = useCallback((cfg) => {
    setConfig(cfg)
    setBaseUrl(cfg?.baseUrl || '')
    setPublicKey(cfg?.publicKey || '')
    setPrivateKey('')
    setEnabled(cfg?.enabled === true)
    setWebhookEnabled(cfg?.webhookEnabled === true)
    setWebhookAutoApply(cfg?.webhookAutoApply === true)
    setWebhookSecret('')
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
      applyConfig(
        await saveDataHubConfig({
          baseUrl,
          publicKey,
          privateKey,
          enabled,
          webhookEnabled,
          webhookAutoApply,
          webhookSecret,
        })
      )
      setToast({ kind: 'success', text: 'DataHub settings saved.' })
    } catch (e) {
      setToast({ kind: 'error', text: e?.message || 'Save failed' })
    } finally {
      setSaving(false)
    }
  }, [baseUrl, publicKey, privateKey, enabled, webhookEnabled, webhookAutoApply, webhookSecret, applyConfig])

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
                  <th scope="row" style={{ textAlign: 'left' }}>Inbound webhooks</th>
                  <td>
                    <span
                      className={
                        config?.webhookEnabled || config?.webhookEffectiveSource === 'environment'
                          ? 'admin-status-badge admin-status-badge--active'
                          : 'admin-status-badge admin-status-badge--inactive'
                      }
                    >
                      {config?.webhookEnabled || config?.webhookEffectiveSource === 'environment'
                        ? 'Enabled'
                        : 'Disabled'}
                    </span>
                    {config?.webhookSecretConfigured ? ' — secret configured' : ' — no secret'}
                  </td>
                </tr>
                <tr className="allocation-table__row">
                  <th scope="row" style={{ textAlign: 'left' }}>Webhook apply policy</th>
                  <td className="text-steel">
                    {config?.webhookEnabled || config?.webhookEffectiveSource === 'environment'
                      ? config?.webhookAutoApplyEffective
                        ? 'Auto-apply (Vessel, Term, Commodity, Port — no review step)'
                        : 'Review first (Resume review on the matching Master page)'
                      : '—'}
                  </td>
                </tr>
                <tr className="allocation-table__row">
                  <th scope="row" style={{ textAlign: 'left' }}>Last webhook</th>
                  <td className="text-steel">
                    {formatWhen(config?.lastWebhookAt)}
                    {config?.lastWebhookError ? ` — ${config.lastWebhookError}` : ''}
                  </td>
                </tr>
                <tr className="allocation-table__row">
                  <th scope="row" style={{ textAlign: 'left' }}>Settings updated</th>
                  <td className="text-steel">{formatWhen(config?.updatedAt)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {Array.isArray(config?.recentWebhookReceipts) && config.recentWebhookReceipts.length > 0 && (
          <div className="table-wrap" style={{ marginTop: '1rem' }}>
            <h3 className="card__title" style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>
              Recent inbound webhook receipts
            </h3>
            <table className="data-table allocation-table">
              <thead>
                <tr>
                  <th>Received</th>
                  <th>Entity</th>
                  <th>Hub code</th>
                  <th>Status</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {config.recentWebhookReceipts.map((rec) => (
                  <tr key={rec.deliveryId} className="allocation-table__row">
                    <td className="text-steel">{formatWhen(rec.receivedAt)}</td>
                    <td>{rec.entityType || '—'}</td>
                    <td className="text-steel">{rec.hubCode || '—'}</td>
                    <td>{rec.status || '—'}</td>
                    <td className="text-steel">{rec.error || rec.event || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-steel" style={{ marginTop: '0.5rem', fontSize: '0.85em' }}>
              If commodity edits in DHM never appear here, the DHM app is not delivering{' '}
              <code>commodity</code> webhooks to{' '}
              <code>{config?.webhookCallbackUrl || 'the callback URL'}</code>.
            </p>
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

      <section className="card at-berth-list-section">
        <div className="card__header-row">
          <h2 className="card__title">Inbound webhooks (DHM → JPS)</h2>
        </div>
        <div className="modal__section" style={{ maxWidth: '46rem' }}>
          <label className="modal__label">Callback URL (register in DHM portal)</label>
          <input
            type="text"
            className="modal__input"
            readOnly
            value={config?.webhookCallbackUrl || ''}
          />
          <p className="text-steel" style={{ marginTop: '0.25rem', fontSize: '0.85em' }}>
            Staging: <code>http://172.28.92.57:3000/api/v1/datahub/webhook</code>. Override display via{' '}
            <code>JPS_DATAHUB_WEBHOOK_CALLBACK_URL</code> on the server.
          </p>

          <label htmlFor="dhm-webhook-secret" className="modal__label" style={{ marginTop: '0.75rem' }}>
            Webhook HMAC secret
          </label>
          <input
            id="dhm-webhook-secret"
            type="password"
            className="modal__input"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder={
              config?.webhookSecretConfigured ? 'Stored — leave blank to keep' : 'whsec_…'
            }
            disabled={saving || loading}
            autoComplete="new-password"
          />
          <p className="text-steel" style={{ marginTop: '0.25rem', fontSize: '0.85em' }}>
            Must match the secret from the DHM integrations page. You can also set{' '}
            <code>DHM_WEBHOOK_SECRET</code> in Backend/.env on the API host.
          </p>

          <label
            htmlFor="dhm-webhook-enabled"
            className="modal__checkbox-label"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem' }}
          >
            <input
              id="dhm-webhook-enabled"
              type="checkbox"
              checked={webhookEnabled}
              onChange={(e) => {
                const on = e.target.checked
                setWebhookEnabled(on)
                if (!on) setWebhookAutoApply(false)
              }}
              disabled={saving || loading}
            />
            Enable inbound DataHub webhooks
          </label>
          <label
            htmlFor="dhm-webhook-auto-apply"
            className="modal__checkbox-label"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}
          >
            <input
              id="dhm-webhook-auto-apply"
              type="checkbox"
              checked={webhookAutoApply}
              onChange={(e) => setWebhookAutoApply(e.target.checked)}
              disabled={saving || loading || !webhookEnabled}
            />
            Auto-apply webhook master changes (Vessel, Term, Commodity, Port)
          </label>
          <p className="text-steel" style={{ marginTop: '0.5rem', fontSize: '0.85em' }}>
            Set the options above, then save. Uncheck auto-apply to stage changes for manual review on
            the relevant Master page. In the DHM portal, register webhooks for each entity you use
            (at least <code>commodity</code> and <code>record.updated</code>).
          </p>
          <p className="text-steel" style={{ marginTop: '0.25rem', fontSize: '0.85em' }}>
            Webhook secret must match DHM. Saved settings here override optional server{' '}
            <code>DHM_*</code> env bootstrap values.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleSave}
              disabled={saving || testing || loading}
            >
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
