import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { buildSampleRecord, suggestNextPalka, validateSample } from '../../utils/qcSampling'
import SampleFields from './SampleFields'

const EMPTY = { noPalka: '', ffa: '', moisture: '' }

/**
 * Primary action of the entry screen: type one palka, "Add and next" saves it to the draft,
 * suggests the next palka number and moves focus to FFA so the keypad stays up.
 */
export default function SampleQuickAdd({ records, onAdd, onPendingChange }) {
  const { t } = useTranslation('qc')
  const [form, setForm] = useState(() => ({ ...EMPTY, noPalka: suggestNextPalka(records) }))
  const [submitted, setSubmitted] = useState(false)
  const refs = { noPalka: useRef(null), ffa: useRef(null), moisture: useRef(null) }

  const result = validateSample(form, records)
  const visibleErrors = submitted ? result.errors : {}
  const touched = form.ffa.trim() !== '' || form.moisture.trim() !== ''

  const change = (next) => {
    setForm(next)
    onPendingChange?.(next.ffa.trim() !== '' || next.moisture.trim() !== '')
  }

  const submit = () => {
    setSubmitted(true)
    if (!result.ok) return
    const record = buildSampleRecord(form)
    onAdd(record)
    setForm({ ...EMPTY, noPalka: suggestNextPalka([...records, record]) })
    setSubmitted(false)
    onPendingChange?.(false)
    refs.ffa.current?.focus()
  }

  const onEnter = (name) => {
    if (name === 'noPalka') refs.ffa.current?.focus()
    else if (name === 'ffa') refs.moisture.current?.focus()
    else submit()
  }

  return (
    <section className="qc-card-block" aria-labelledby="qc-quick-add-title">
      <h2 id="qc-quick-add-title" className="qc-card-block__title">
        {t('entry.sectionAdd')}
      </h2>
      <SampleFields
        form={form}
        errors={visibleErrors}
        onChange={change}
        onEnter={onEnter}
        refs={refs}
        idPrefix="qc-add"
      />
      {result.duplicate && touched ? (
        <p className="qc-warning" role="status">
          {t('quickAdd.duplicate', { palka: form.noPalka.trim() })}
        </p>
      ) : null}
      <button type="button" className="op-btn op-btn--primary op-btn--block" onClick={submit}>
        {t('quickAdd.add')}
      </button>
    </section>
  )
}
