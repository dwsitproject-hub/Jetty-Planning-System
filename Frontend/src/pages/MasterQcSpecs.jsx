import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import QcSpecTemplateModal from '../components/qc/QcSpecTemplateModal'
import MasterSourceBadge from '../components/MasterSourceBadge.jsx'
import { useActivityLog } from '../context/ActivityLogContext'
import { useRbac } from '../context/RbacContext'
import { formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'
import {
  createQcSpecParameter,
  createQcSpecTemplate,
  deleteQcSpecTemplate,
  fetchQcSpecCommodities,
  fetchQcSpecParameters,
  fetchQcSpecTemplates,
  updateQcSpecTemplate,
} from '../api/qcSpecs'
import '../styles/allocation.css'

const PAGE_KEY = 'master-qc-spec'

export default function MasterQcSpecs() {
  const { t } = useTranslation('pages')
  const { logActivity } = useActivityLog()
  const { canEdit, canDelete, canView } = useRbac()
  const [templates, setTemplates] = useState([])
  const [parameters, setParameters] = useState([])
  const [commodities, setCommodities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [list, params, comms] = await Promise.all([
        fetchQcSpecTemplates(),
        fetchQcSpecParameters(),
        fetchQcSpecCommodities(),
      ])
      setTemplates(list)
      setParameters(params)
      setCommodities(comms)
    } catch (e) {
      setError(e?.message || t('qcSpec.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  if (!canView(PAGE_KEY)) {
    return <p className="text-steel">{t('qcSpec.noAccess')}</p>
  }

  const save = async (body) => {
    setSaving(true)
    setError('')
    try {
      const out = editing?.id ? await updateQcSpecTemplate(editing.id, body) : await createQcSpecTemplate(body)
      setTemplates(out.templates)
      logActivity({
        pageKey: PAGE_KEY,
        action: editing?.id ? 'update' : 'add',
        entityType: 'QcSpecTemplate',
        entityLabel: body.name,
      })
      setEditing(null)
      const comms = await fetchQcSpecCommodities()
      setCommodities(comms)
    } catch (e) {
      setError(e?.message || t('qcSpec.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="allocation-page">
      <h1 className="page-title page-title-row">
        {t('qcSpec.pageTitle')}
        <MasterSourceBadge kind="local" />
      </h1>
      <p className="allocation-page__intro">{t('qcSpec.intro')}</p>
      <p className="text-steel" style={{ fontSize: 'var(--font-size-small)' }}>
        <Link to="/master" className="link">
          ← {t('qcSpec.back')}
        </Link>
      </p>

      <section className="card">
        <div className="card__header-row">
          <h2 className="card__title">{t('qcSpec.listTitle')}</h2>
          {canEdit(PAGE_KEY) ? (
            <button type="button" className="btn btn--primary" onClick={() => setEditing({})}>
              {t('qcSpec.add')}
            </button>
          ) : null}
        </div>
        {loading ? <p className="text-steel">{t('qcSpec.loading')}</p> : null}
        {error && !editing ? <p className="text-error">{error}</p> : null}
        <div className="table-wrap table-wrap--pin-actions table-wrap--pin-actions--pair">
          <table className="data-table allocation-table">
            <thead>
              <tr>
                <th className="allocation-table__action-col">{t('qcSpec.colActions')}</th>
                <th>{t('qcSpec.colName')}</th>
                <th>{t('qcSpec.colCommodities')}</th>
                <th>{t('qcSpec.colParams')}</th>
                <th>{t('qcSpec.colUpdated')}</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((row) => (
                <tr key={row.id} className="allocation-table__row">
                  <td className="allocation-table__action-col">
                    <div className="allocation-table__action-btns">
                      {canEdit(PAGE_KEY) ? (
                        <button type="button" className="btn btn--small btn--edit" onClick={() => setEditing(row)}>
                          {t('qcSpec.edit')}
                        </button>
                      ) : null}
                      {canDelete(PAGE_KEY) ? (
                        <button
                          type="button"
                          className="btn btn--small btn--delete"
                          onClick={async () => {
                            if (!window.confirm(t('qcSpec.deleteConfirm', { name: row.name }))) return
                            await deleteQcSpecTemplate(row.id)
                            logActivity({
                              pageKey: PAGE_KEY,
                              action: 'delete',
                              entityType: 'QcSpecTemplate',
                              entityLabel: row.name,
                            })
                            load()
                          }}
                        >
                          {t('qcSpec.delete')}
                        </button>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <strong>{row.name}</strong>
                  </td>
                  <td>{(row.commodities || []).map((c) => c.shortName || c.name).join(', ') || '—'}</td>
                  <td>{(row.parameters || []).length}</td>
                  <td>{row.updatedAt ? formatDateTimeDisplay(row.updatedAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && templates.length === 0 ? <p className="text-steel">{t('qcSpec.empty')}</p> : null}
        </div>
      </section>

      {editing ? (
        <QcSpecTemplateModal
          key={editing.id || 'new'}
          open
          template={editing.id ? editing : null}
          templates={templates}
          parameters={parameters}
          commodities={commodities}
          saving={saving}
          error={error}
          onClose={() => {
            setEditing(null)
            setError('')
          }}
          onSave={save}
          onCreateParameter={async (body) => {
            const out = await createQcSpecParameter(body)
            setParameters((prev) => [...prev, out.parameter])
            return out.parameter
          }}
        />
      ) : null}
    </div>
  )
}
