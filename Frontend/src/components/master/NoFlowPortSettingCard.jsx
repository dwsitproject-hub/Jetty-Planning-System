import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchNoFlowPortSetting, updateNoFlowPortSetting } from '../../api/masterNoFlowReasons'

/** Per-port minimum stop length (minutes) before a stop needs a no-flow reason. */
export default function NoFlowPortSettingCard({ portId, canEdit }) {
  const { t } = useTranslation('pages')
  const [setting, setSetting] = useState(null)
  const [value, setValue] = useState('')
  const [message, setMessage] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!portId) return
    setMessage(null)
    fetchNoFlowPortSetting(portId)
      .then((s) => {
        setSetting(s)
        setValue(String(s.minMinutes))
      })
      .catch((e) => setMessage({ error: true, text: e?.message || t('noFlowLoadFailed') }))
  }, [portId, t])

  const save = async () => {
    const n = Number.parseInt(value, 10)
    if (!(n >= 5 && n <= 1440)) return setMessage({ error: true, text: t('noFlowMinInvalid') })
    setSaving(true)
    try {
      setSetting(await updateNoFlowPortSetting(Number(portId), n))
      setMessage({ error: false, text: t('noFlowMinSaved') })
    } catch (e) {
      setMessage({ error: true, text: e?.message || t('kurasRuleSaveFailed') })
    } finally {
      setSaving(false)
    }
    return undefined
  }

  if (!portId || !setting) return null
  return (
    <section className="card" style={{ marginBottom: '1rem' }}>
      <h2 className="card__title">{t('noFlowMinTitle', { port: setting.portName || '' })}</h2>
      <p className="text-steel">{t('noFlowMinDesc')}</p>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          id="no-flow-min-minutes"
          aria-label={t('noFlowMinLabel')}
          className="modal__input"
          style={{ width: '8rem' }}
          type="number"
          min="5"
          max="1440"
          step="5"
          value={value}
          disabled={!canEdit}
          onChange={(e) => setValue(e.target.value)}
        />
        <span className="text-steel">{t('noFlowMinUnit')}</span>
        <button type="button" className="btn btn--secondary btn--small" onClick={save} disabled={!canEdit || saving}>
          {saving ? t('kurasRuleSaving') : t('kurasRuleSave')}
        </button>
        {message ? (
          <span role="status" style={{ color: message.error ? 'var(--color-danger, #c00)' : 'var(--color-success, #0a7)' }}>
            {message.text}
          </span>
        ) : null}
      </div>
    </section>
  )
}
