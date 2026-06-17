import { useState, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchPartnerKeys, createPartnerKey, revokePartnerKey } from '../api/integrationAdmin'
import '../styles/allocation.css'
import '../styles/modal.css'
import '../styles/admin.css'

function maskKey(prefix) {
  if (!prefix) return '—'
  return `${prefix}…`
}

function formatWhen(value) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

export default function AdminPartnerApi() {
  const [keys, setKeys] = useState([])
  const [loading, setLoading] = useState(true)
  const [listErr, setListErr] = useState(null)
  const [toast, setToast] = useState(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [formPartnerName, setFormPartnerName] = useState('')
  const [modalErr, setModalErr] = useState(null)
  const [saving, setSaving] = useState(false)

  // One-time plaintext reveal after creation.
  const [createdKey, setCreatedKey] = useState(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setListErr(null)
    setLoading(true)
    try {
      const list = await fetchPartnerKeys()
      setKeys(Array.isArray(list) ? list : [])
    } catch (e) {
      setListErr(e?.message || 'Failed to load API keys (sign in as admin?)')
      setKeys([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 3000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const openAdd = useCallback(() => {
    setFormPartnerName('')
    setModalErr(null)
    setCreatedKey(null)
    setCopied(false)
    setModalOpen(true)
  }, [])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setModalErr(null)
    // Clear the plaintext from memory once the modal is dismissed.
    setCreatedKey(null)
    setCopied(false)
  }, [])

  const handleSubmit = useCallback(async () => {
    const partnerName = (formPartnerName || '').trim()
    if (!partnerName) {
      setModalErr('Partner name is required')
      return
    }
    setModalErr(null)
    setSaving(true)
    try {
      const created = await createPartnerKey(partnerName)
      setCreatedKey(created)
      await load()
      setToast({ kind: 'success', text: 'API key created. Copy it now — it cannot be shown again.' })
    } catch (e) {
      setModalErr(e?.message || 'Create failed')
    } finally {
      setSaving(false)
    }
  }, [formPartnerName, load])

  const handleCopy = useCallback(async () => {
    const plaintext = createdKey?.plaintextKey
    if (!plaintext) return
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(plaintext)
        setCopied(true)
        setToast({ kind: 'success', text: 'API key copied to clipboard.' })
      } else {
        window.prompt('Copy API key', plaintext)
      }
    } catch {
      window.prompt('Copy API key', plaintext)
    }
  }, [createdKey])

  const handleRevoke = useCallback(
    async (key) => {
      if (!window.confirm(`Revoke the API key for "${key.partnerName}"? This cannot be undone and the partner will be locked out immediately.`)) {
        return
      }
      try {
        await revokePartnerKey(key.id)
        await load()
        setToast({ kind: 'success', text: 'API key revoked.' })
      } catch (e) {
        setToast({ kind: 'error', text: e?.message || 'Revoke failed' })
      }
    },
    [load]
  )

  return (
    <div className="allocation-page">
      <h1 className="page-title">Partner API Keys</h1>
      <p className="allocation-page__intro">
        <Link to="/admin" className="link">← Back to Admin</Link>
      </p>
      <p className="text-steel" style={{ marginTop: 0 }}>
        Provision and revoke <code>x-api-key</code> credentials for external systems (e.g. EOS-EXPORT, KLIPS) that submit Shipping Instructions through the integration API. A key works for any port; each request must include a valid <code>port_id</code>.
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
      {listErr && <p style={{ color: '#c00' }}>{listErr}</p>}

      <section className="card at-berth-list-section">
        <div className="card__header-row">
          <h2 className="card__title">Partners</h2>
          <button type="button" className="btn btn--primary" onClick={openAdd}>
            Add Partner Key
          </button>
        </div>
        {loading ? (
          <p className="text-steel">Loading…</p>
        ) : keys.length === 0 ? (
          <p className="text-steel">No API keys yet. Create one to onboard a partner.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table allocation-table">
              <thead>
                <tr>
                  <th className="allocation-table__th">Partner</th>
                  <th className="allocation-table__th">Key</th>
                  <th className="allocation-table__th">Status</th>
                  <th className="allocation-table__th">Created</th>
                  <th className="allocation-table__th">Last used</th>
                  <th className="allocation-table__action-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="allocation-table__row" style={k.active ? undefined : { opacity: 0.6 }}>
                    <td><strong>{k.partnerName || '—'}</strong></td>
                    <td><code>{maskKey(k.keyPrefix)}</code></td>
                    <td>
                      <span className={k.active ? 'admin-status-badge admin-status-badge--active' : 'admin-status-badge admin-status-badge--inactive'}>
                        {k.active ? 'Active' : 'Revoked'}
                      </span>
                    </td>
                    <td className="text-steel">{formatWhen(k.createdAt)}</td>
                    <td className="text-steel">{formatWhen(k.lastUsedAt)}</td>
                    <td className="allocation-table__action-col">
                      {k.active ? (
                        <button type="button" className="btn btn--small btn--secondary" onClick={() => handleRevoke(k)}>
                          Revoke
                        </button>
                      ) : (
                        <span className="text-steel">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modalOpen && (
        <div className="modal-overlay" onClick={closeModal} aria-hidden="true">
          <div className="modal modal--wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="partner-modal-title" aria-modal="true">
            {createdKey ? (
              <>
                <h2 id="partner-modal-title" className="modal__title">API Key Created</h2>
                <div className="modal__section">
                  <p style={{ marginTop: 0, color: '#9a6700', fontWeight: 600 }}>
                    Copy this key now. For security it is shown only once and cannot be retrieved again after you close this dialog.
                  </p>
                </div>
                <div className="modal__section">
                  <div className="modal__label">Partner</div>
                  <p style={{ marginTop: 4 }}><strong>{createdKey.partnerName}</strong></p>
                </div>
                <div className="modal__section">
                  <div className="modal__label">API key (plaintext)</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                    <input
                      type="text"
                      className="modal__input"
                      style={{ margin: 0, fontFamily: 'monospace' }}
                      value={createdKey.plaintextKey}
                      readOnly
                      onFocus={(e) => e.target.select()}
                    />
                    <button type="button" className="btn btn--secondary" onClick={handleCopy}>
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
                <div className="modal__footer">
                  <button type="button" className="btn btn--primary" onClick={closeModal}>Done</button>
                </div>
              </>
            ) : (
              <>
                <h2 id="partner-modal-title" className="modal__title">Add Partner Key</h2>
                <div className="modal__section">
                  <label htmlFor="partner-name" className="modal__label">Partner name</label>
                  <input
                    id="partner-name"
                    type="text"
                    className="modal__input"
                    value={formPartnerName}
                    onChange={(e) => setFormPartnerName(e.target.value)}
                    placeholder="e.g. EOS-EXPORT"
                  />
                  <p className="text-steel" style={{ marginTop: 8 }}>
                    The key is not tied to a port. Partners pass a valid <code>port_id</code> on each request.
                  </p>
                </div>
                {modalErr && <p style={{ color: '#c00' }}>{modalErr}</p>}
                <div className="modal__footer">
                  <button type="button" className="btn btn--secondary" onClick={closeModal}>Cancel</button>
                  <button type="button" className="btn btn--primary" onClick={handleSubmit} disabled={saving}>
                    {saving ? 'Creating…' : 'Create key'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
