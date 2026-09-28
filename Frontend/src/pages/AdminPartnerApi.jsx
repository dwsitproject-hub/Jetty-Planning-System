import { useState, useCallback, useEffect, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  fetchPartnerKeys,
  createPartnerKey,
  revokePartnerKey,
  fetchPartnerWebhooks,
  createPartnerWebhook,
  patchPartnerWebhook,
  deactivatePartnerWebhook,
  fetchWebhookDeliveries,
  retryWebhookDelivery,
} from '../api/integrationAdmin'
import '../styles/allocation.css'
import '../styles/modal.css'
import '../styles/admin.css'
import '../styles/partner-integrations.css'

function maskKey(prefix) {
  if (!prefix) return '—'
  return `${prefix}…`
}

function formatWhen(value) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function formatEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return '—'
  if (events.includes('*')) return 'All events'
  return events.join(', ')
}

function deliveryStatusBadgeClass(status) {
  if (status === 'sent') return 'admin-status-badge admin-status-badge--active'
  if (status === 'failed') return 'admin-status-badge admin-status-badge--error'
  return 'admin-status-badge admin-status-badge--warning'
}

const ALL_EVENTS = ['status.changed', 'schedule.updated']

export default function AdminPartnerApi() {
  const { t } = useTranslation('pages')
  const [keys, setKeys] = useState([])
  const [selectedKeyId, setSelectedKeyId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [listErr, setListErr] = useState(null)
  const [toast, setToast] = useState(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [formPartnerName, setFormPartnerName] = useState('')
  const [modalErr, setModalErr] = useState(null)
  const [saving, setSaving] = useState(false)
  const [createdKey, setCreatedKey] = useState(null)
  const [copied, setCopied] = useState(false)

  const [webhooks, setWebhooks] = useState([])
  const [webhooksLoading, setWebhooksLoading] = useState(false)
  const [webhooksErr, setWebhooksErr] = useState(null)

  const [webhookModalOpen, setWebhookModalOpen] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookEvents, setWebhookEvents] = useState(['*'])
  const [webhookSaving, setWebhookSaving] = useState(false)
  const [webhookModalErr, setWebhookModalErr] = useState(null)
  const [createdWebhookSecret, setCreatedWebhookSecret] = useState(null)
  const [secretCopied, setSecretCopied] = useState(false)

  const [deliveriesOpen, setDeliveriesOpen] = useState(false)
  const [deliveriesEndpoint, setDeliveriesEndpoint] = useState(null)
  const [deliveries, setDeliveries] = useState([])
  const [deliveriesTotal, setDeliveriesTotal] = useState(0)
  const [deliveriesLoading, setDeliveriesLoading] = useState(false)
  const [expandedDeliveryId, setExpandedDeliveryId] = useState(null)

  const selectedKey = keys.find((k) => k.id === selectedKeyId) ?? null

  const load = useCallback(async () => {
    setListErr(null)
    setLoading(true)
    try {
      const list = await fetchPartnerKeys()
      const arr = Array.isArray(list) ? list : []
      setKeys(arr)
      setSelectedKeyId((prev) => {
        if (prev != null && arr.some((k) => k.id === prev)) return prev
        return arr[0]?.id ?? null
      })
    } catch (e) {
      setListErr(e?.message || 'Failed to load API keys (sign in as admin?)')
      setKeys([])
    } finally {
      setLoading(false)
    }
  }, [])

  const loadWebhooks = useCallback(async (keyId) => {
    if (keyId == null) {
      setWebhooks([])
      return
    }
    setWebhooksErr(null)
    setWebhooksLoading(true)
    try {
      const data = await fetchPartnerWebhooks(keyId)
      setWebhooks(Array.isArray(data?.endpoints) ? data.endpoints : [])
    } catch (e) {
      setWebhooksErr(e?.message || 'Failed to load webhooks')
      setWebhooks([])
    } finally {
      setWebhooksLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    loadWebhooks(selectedKeyId)
  }, [selectedKeyId, loadWebhooks])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 4000)
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
      setSelectedKeyId(created.id)
      setToast({ kind: 'success', text: t('adminPartnerApiKeyCreatedToast') })
    } catch (e) {
      setModalErr(e?.message || 'Create failed')
    } finally {
      setSaving(false)
    }
  }, [formPartnerName, load, t])

  const handleCopy = useCallback(async () => {
    const plaintext = createdKey?.plaintextKey
    if (!plaintext) return
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(plaintext)
        setCopied(true)
      } else {
        window.prompt('Copy API key', plaintext)
      }
    } catch {
      window.prompt('Copy API key', plaintext)
    }
  }, [createdKey])

  const handleRevoke = useCallback(
    async (key) => {
      if (!window.confirm(t('adminPartnerApiRevokeConfirm', { name: key.partnerName }))) return
      try {
        await revokePartnerKey(key.id)
        await load()
        setToast({ kind: 'success', text: t('adminPartnerApiRevokedToast') })
      } catch (e) {
        setToast({ kind: 'error', text: e?.message || 'Revoke failed' })
      }
    },
    [load, t]
  )

  const openAddWebhook = useCallback(() => {
    setWebhookUrl('')
    setWebhookEvents(['*'])
    setWebhookModalErr(null)
    setCreatedWebhookSecret(null)
    setSecretCopied(false)
    setWebhookModalOpen(true)
  }, [])

  const closeWebhookModal = useCallback(() => {
    setWebhookModalOpen(false)
    setCreatedWebhookSecret(null)
    setSecretCopied(false)
  }, [])

  const toggleWebhookEvent = useCallback((ev) => {
    if (ev === '*') {
      setWebhookEvents(['*'])
      return
    }
    setWebhookEvents((prev) => {
      const withoutStar = prev.filter((e) => e !== '*')
      if (withoutStar.includes(ev)) {
        const next = withoutStar.filter((e) => e !== ev)
        return next.length === 0 ? ['*'] : next
      }
      return [...withoutStar, ev]
    })
  }, [])

  const handleCreateWebhook = useCallback(async () => {
    const url = (webhookUrl || '').trim()
    if (!url) {
      setWebhookModalErr(t('adminPartnerApiWebhookUrlRequired'))
      return
    }
    if (selectedKeyId == null) return
    setWebhookSaving(true)
    setWebhookModalErr(null)
    try {
      const res = await createPartnerWebhook(selectedKeyId, { url, events: webhookEvents })
      setCreatedWebhookSecret({
        secret: res.plaintextSecret,
        note: res.secretNote,
      })
      await loadWebhooks(selectedKeyId)
      setToast({ kind: 'success', text: t('adminPartnerApiWebhookCreatedToast') })
    } catch (e) {
      setWebhookModalErr(e?.message || 'Create webhook failed')
    } finally {
      setWebhookSaving(false)
    }
  }, [webhookUrl, webhookEvents, selectedKeyId, loadWebhooks, t])

  const handleCopySecret = useCallback(async () => {
    const secret = createdWebhookSecret?.secret
    if (!secret) return
    try {
      await navigator.clipboard.writeText(secret)
      setSecretCopied(true)
    } catch {
      window.prompt('Copy webhook secret', secret)
    }
  }, [createdWebhookSecret])

  const handleDisableWebhook = useCallback(
    async (ep) => {
      if (selectedKeyId == null) return
      if (!window.confirm(t('adminPartnerApiDisableConfirm'))) return
      try {
        await deactivatePartnerWebhook(selectedKeyId, ep.id)
        await loadWebhooks(selectedKeyId)
        setToast({ kind: 'success', text: t('adminPartnerApiWebhookDisabledToast') })
      } catch (e) {
        setToast({ kind: 'error', text: e?.message || 'Disable failed' })
      }
    },
    [selectedKeyId, loadWebhooks, t]
  )

  const handleEnableWebhook = useCallback(
    async (ep) => {
      if (selectedKeyId == null) return
      try {
        await patchPartnerWebhook(selectedKeyId, ep.id, { active: true })
        await loadWebhooks(selectedKeyId)
        setToast({ kind: 'success', text: t('adminPartnerApiWebhookEnabledToast') })
      } catch (e) {
        setToast({ kind: 'error', text: e?.message || 'Enable failed' })
      }
    },
    [selectedKeyId, loadWebhooks, t]
  )

  const openDeliveries = useCallback(
    async (ep) => {
      if (selectedKeyId == null) return
      setDeliveriesEndpoint(ep)
      setDeliveriesOpen(true)
      setDeliveriesLoading(true)
      setExpandedDeliveryId(null)
      try {
        const data = await fetchWebhookDeliveries(selectedKeyId, ep.id, { limit: 50 })
        setDeliveries(Array.isArray(data?.deliveries) ? data.deliveries : [])
        setDeliveriesTotal(data?.total ?? 0)
      } catch (e) {
        setDeliveries([])
        setDeliveriesTotal(0)
        setToast({ kind: 'error', text: e?.message || 'Failed to load deliveries' })
      } finally {
        setDeliveriesLoading(false)
      }
    },
    [selectedKeyId]
  )

  const handleRetryDelivery = useCallback(
    async (deliveryId) => {
      if (selectedKeyId == null || !deliveriesEndpoint) return
      try {
        await retryWebhookDelivery(selectedKeyId, deliveriesEndpoint.id, deliveryId)
        const data = await fetchWebhookDeliveries(selectedKeyId, deliveriesEndpoint.id, { limit: 50 })
        setDeliveries(Array.isArray(data?.deliveries) ? data.deliveries : [])
        setToast({ kind: 'success', text: t('adminPartnerApiDeliveryRetryToast') })
      } catch (e) {
        setToast({ kind: 'error', text: e?.message || 'Retry failed' })
      }
    },
    [selectedKeyId, deliveriesEndpoint, t]
  )

  return (
    <div className="allocation-page partner-integrations-page">
      <div className="partner-integrations-page__header">
        <div className="partner-integrations-page__header-text">
          <h1 className="page-title">{t('adminHubPartnerApiTitle')}</h1>
          <p className="allocation-page__intro">
            <Link to="/admin" className="link">{t('adminBackLink')}</Link>
          </p>
        </div>
        <button type="button" className="btn btn--primary" onClick={openAdd}>
          {t('adminPartnerApiAddKey')}
        </button>
      </div>

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

      <div className="partner-integrations-layout">
        <aside className="partner-integrations-sidebar card">
          <h2 className="partner-integrations-sidebar__title">{t('adminPartnerApiPartnersNav')}</h2>
          {loading ? (
            <p className="partner-integrations-sidebar__empty">{t('adminPartnerApiLoading')}</p>
          ) : keys.length === 0 ? (
            <p className="partner-integrations-sidebar__empty">{t('adminPartnerApiNoKeys')}</p>
          ) : (
            <ul className="partner-integrations-nav">
              {keys.map((k) => (
                <li key={k.id}>
                  <button
                    type="button"
                    className={`partner-integrations-nav__item ${selectedKeyId === k.id ? 'is-active' : ''}`}
                    onClick={() => setSelectedKeyId(k.id)}
                  >
                    <span className="partner-integrations-nav__name">{k.partnerName}</span>
                    <span className="partner-integrations-nav__slug">{maskKey(k.keyPrefix)}</span>
                    {!k.active && (
                      <span className="admin-status-badge admin-status-badge--inactive partner-integrations-nav__badge">
                        {t('adminPartnerApiStatusRevoked')}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="partner-integrations-content">
          {!selectedKey ? (
            <p className="partner-integrations-content__placeholder">{t('adminPartnerApiSelectPartner')}</p>
          ) : (
            <>
              <section className="card">
                <h2 className="card__title">{t('adminPartnerApiCredentials')}</h2>
                <dl className="partner-integrations-kv">
                  <dt>{t('adminPartnerApiColPartner')}</dt>
                  <dd><strong>{selectedKey.partnerName}</strong></dd>

                  <dt>{t('adminPartnerApiColKey')}</dt>
                  <dd><code>{maskKey(selectedKey.keyPrefix)}</code></dd>

                  <dt>{t('adminPartnerApiColStatus')}</dt>
                  <dd>
                    <span className={selectedKey.active ? 'admin-status-badge admin-status-badge--active' : 'admin-status-badge admin-status-badge--inactive'}>
                      {selectedKey.active ? t('adminPartnerApiStatusActive') : t('adminPartnerApiStatusRevoked')}
                    </span>
                  </dd>

                  <dt>{t('adminPartnerApiColLastUsed')}</dt>
                  <dd>{formatWhen(selectedKey.lastUsedAt)}</dd>
                </dl>
                {selectedKey.active && (
                  <div className="partner-integrations-card__footer">
                    <button type="button" className="partner-link-action partner-link-action--danger" onClick={() => handleRevoke(selectedKey)}>
                      {t('adminPartnerApiRevoke')}
                    </button>
                  </div>
                )}
              </section>

              <section className="card">
                <div className="card__header-row">
                  <h2 className="card__title">{t('adminPartnerApiWebhooks')}</h2>
                  {selectedKey.active && (
                    <button type="button" className="btn btn--primary btn--small" onClick={openAddWebhook}>
                      {t('adminPartnerApiAddWebhook')}
                    </button>
                  )}
                </div>
                {webhooksErr && <p style={{ color: '#c00' }}>{webhooksErr}</p>}
                {webhooksLoading ? (
                  <p className="text-steel">{t('adminPartnerApiLoading')}</p>
                ) : webhooks.length === 0 ? (
                  <p className="partner-integrations-empty">{t('adminPartnerApiNoWebhooks')}</p>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table partner-webhook-table">
                      <thead>
                        <tr>
                          <th>{t('adminPartnerApiWebhookUrl')}</th>
                          <th>{t('adminPartnerApiWebhookEvents')}</th>
                          <th>{t('adminPartnerApiWebhookActive')}</th>
                          <th className="partner-webhook-table__actions-th">{t('adminPartnerApiWebhookActions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {webhooks.map((ep) => (
                          <tr key={ep.id}>
                            <td className="partner-webhook-table__url">{ep.url}</td>
                            <td className="text-steel">{formatEvents(ep.events)}</td>
                            <td>
                              <span className={ep.active ? 'admin-status-badge admin-status-badge--active' : 'admin-status-badge admin-status-badge--inactive'}>
                                {ep.active ? t('adminPartnerApiStatusActive') : t('adminPartnerApiStatusInactive')}
                              </span>
                            </td>
                            <td className="partner-webhook-table__actions">
                              <button type="button" className="partner-link-action" onClick={() => openDeliveries(ep)}>
                                {t('adminPartnerApiDeliveries')}
                              </button>
                              {selectedKey.active && (
                                <>
                                  <span className="partner-webhook-table__sep">·</span>
                                  {ep.active ? (
                                    <button type="button" className="partner-link-action partner-link-action--danger" onClick={() => handleDisableWebhook(ep)}>
                                      {t('adminPartnerApiDisable')}
                                    </button>
                                  ) : (
                                    <button type="button" className="partner-link-action" onClick={() => handleEnableWebhook(ep)}>
                                      {t('adminPartnerApiEnable')}
                                    </button>
                                  )}
                                </>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>

      {modalOpen && (
        <div className="modal-overlay" onClick={closeModal} aria-hidden="true">
          <div className="modal modal--wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="partner-modal-title" aria-modal="true">
            {createdKey ? (
              <>
                <h2 id="partner-modal-title" className="modal__title">{t('adminPartnerApiKeyCreatedTitle')}</h2>
                <div className="modal__section">
                  <p style={{ marginTop: 0, color: '#9a6700', fontWeight: 600 }}>{t('adminPartnerApiKeyCreatedWarning')}</p>
                </div>
                <div className="modal__section">
                  <div className="modal__label">{t('adminPartnerApiColPartner')}</div>
                  <p style={{ marginTop: 4 }}><strong>{createdKey.partnerName}</strong></p>
                </div>
                <div className="modal__section">
                  <div className="modal__label">{t('adminPartnerApiPlaintextKey')}</div>
                  <div className="partner-secret-reveal">
                    <input
                      type="text"
                      className="modal__input"
                      style={{ margin: 0 }}
                      value={createdKey.plaintextKey}
                      readOnly
                      onFocus={(e) => e.target.select()}
                    />
                    <button type="button" className="btn btn--secondary" onClick={handleCopy}>
                      {copied ? t('adminPartnerApiCopied') : t('adminPartnerApiCopy')}
                    </button>
                  </div>
                </div>
                <div className="modal__footer">
                  <button type="button" className="btn btn--primary" onClick={closeModal}>{t('adminPartnerApiDone')}</button>
                </div>
              </>
            ) : (
              <>
                <h2 id="partner-modal-title" className="modal__title">{t('adminPartnerApiAddKey')}</h2>
                <div className="modal__section">
                  <label htmlFor="partner-name" className="modal__label">{t('adminPartnerApiPartnerNameLabel')}</label>
                  <input
                    id="partner-name"
                    type="text"
                    className="modal__input"
                    value={formPartnerName}
                    onChange={(e) => setFormPartnerName(e.target.value)}
                    placeholder="e.g. EOS-EXPORT"
                  />
                </div>
                {modalErr && <p style={{ color: '#c00' }}>{modalErr}</p>}
                <div className="modal__footer">
                  <button type="button" className="btn btn--secondary" onClick={closeModal}>{t('adminPartnerApiCancel')}</button>
                  <button type="button" className="btn btn--primary" onClick={handleSubmit} disabled={saving}>
                    {saving ? t('adminPartnerApiCreating') : t('adminPartnerApiCreateKey')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {webhookModalOpen && (
        <div className="modal-overlay" onClick={closeWebhookModal} aria-hidden="true">
          <div className="modal modal--wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            {createdWebhookSecret ? (
              <>
                <h2 className="modal__title">{t('adminPartnerApiWebhookSecretTitle')}</h2>
                <p style={{ color: '#9a6700', fontWeight: 600 }}>{createdWebhookSecret.note || t('adminPartnerApiWebhookSecretWarning')}</p>
                <div className="modal__section">
                  <div className="partner-secret-reveal">
                    <input
                      type="text"
                      className="modal__input"
                      style={{ margin: 0 }}
                      value={createdWebhookSecret.secret}
                      readOnly
                      onFocus={(e) => e.target.select()}
                    />
                    <button type="button" className="btn btn--secondary" onClick={handleCopySecret}>
                      {secretCopied ? t('adminPartnerApiCopied') : t('adminPartnerApiCopy')}
                    </button>
                  </div>
                </div>
                <div className="modal__footer">
                  <button type="button" className="btn btn--primary" onClick={closeWebhookModal}>{t('adminPartnerApiDone')}</button>
                </div>
              </>
            ) : (
              <>
                <h2 className="modal__title">{t('adminPartnerApiAddWebhook')}</h2>
                <div className="modal__section">
                  <label className="modal__label" htmlFor="wh-url">{t('adminPartnerApiWebhookUrl')}</label>
                  <input
                    id="wh-url"
                    type="url"
                    className="modal__input"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="https://partner.example/jps/webhook"
                  />
                </div>
                <div className="modal__section">
                  <div className="modal__label">{t('adminPartnerApiWebhookEvents')}</div>
                  <div className="partner-integrations-events">
                    <label>
                      <input type="checkbox" checked={webhookEvents.includes('*')} onChange={() => toggleWebhookEvent('*')} />
                      {t('adminPartnerApiWebhookAllEvents')}
                    </label>
                    {ALL_EVENTS.map((ev) => (
                      <label key={ev}>
                        <input
                          type="checkbox"
                          checked={webhookEvents.includes('*') || webhookEvents.includes(ev)}
                          disabled={webhookEvents.includes('*')}
                          onChange={() => toggleWebhookEvent(ev)}
                        />
                        {ev}
                      </label>
                    ))}
                  </div>
                </div>
                {webhookModalErr && <p style={{ color: '#c00' }}>{webhookModalErr}</p>}
                <div className="modal__footer">
                  <button type="button" className="btn btn--secondary" onClick={closeWebhookModal}>{t('adminPartnerApiCancel')}</button>
                  <button type="button" className="btn btn--primary" onClick={handleCreateWebhook} disabled={webhookSaving}>
                    {webhookSaving ? t('adminPartnerApiSaving') : t('adminPartnerApiSaveWebhook')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {deliveriesOpen && deliveriesEndpoint && (
        <div className="modal-overlay" onClick={() => setDeliveriesOpen(false)} aria-hidden="true">
          <div className="modal modal--wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal__title">{t('adminPartnerApiDeliveriesTitle')}</h2>
            <p className="text-steel" style={{ wordBreak: 'break-all', marginTop: -8 }}>{deliveriesEndpoint.url}</p>
            {deliveriesLoading ? (
              <p className="text-steel">{t('adminPartnerApiLoading')}</p>
            ) : (
              <>
                <p className="partner-deliveries-summary">{t('adminPartnerApiDeliveriesCount', { count: deliveriesTotal })}</p>
                {deliveries.length === 0 ? (
                  <p className="partner-integrations-empty">{t('adminPartnerApiNoDeliveries')}</p>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table partner-deliveries-table">
                      <thead>
                        <tr>
                          <th>{t('adminPartnerApiDeliveryId')}</th>
                          <th>{t('adminPartnerApiDeliveryEvent')}</th>
                          <th>{t('adminPartnerApiDeliveryRef')}</th>
                          <th>{t('adminPartnerApiColStatus')}</th>
                          <th>{t('adminPartnerApiDeliveryWhen')}</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {deliveries.map((d) => (
                          <Fragment key={d.delivery_id}>
                            <tr>
                              <td><span className="partner-deliveries-id">{d.delivery_id}</span></td>
                              <td>{d.event_type}</td>
                              <td>{d.external_reference}</td>
                              <td>
                                <span className={deliveryStatusBadgeClass(d.status)}>{d.status}</span>
                                {d.last_error && <div className="partner-deliveries-error">{d.last_error}</div>}
                              </td>
                              <td>{formatWhen(d.sent_at || d.created_at)}</td>
                              <td className="partner-webhook-table__actions">
                                <button
                                  type="button"
                                  className="partner-link-action partner-link-action--muted"
                                  onClick={() => setExpandedDeliveryId((x) => (x === d.delivery_id ? null : d.delivery_id))}
                                >
                                  {expandedDeliveryId === d.delivery_id ? t('adminPartnerApiHidePayload') : t('adminPartnerApiShowPayload')}
                                </button>
                                {d.status === 'failed' && (
                                  <>
                                    <span className="partner-webhook-table__sep">·</span>
                                    <button type="button" className="partner-link-action" onClick={() => handleRetryDelivery(d.delivery_id)}>
                                      {t('adminPartnerApiRetry')}
                                    </button>
                                  </>
                                )}
                              </td>
                            </tr>
                            {expandedDeliveryId === d.delivery_id && (
                              <tr>
                                <td colSpan={6}>
                                  <pre className="partner-deliveries-payload">{JSON.stringify(d.payload, null, 2)}</pre>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
            <div className="modal__footer">
              <button type="button" className="btn btn--primary" onClick={() => setDeliveriesOpen(false)}>{t('adminPartnerApiDone')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
