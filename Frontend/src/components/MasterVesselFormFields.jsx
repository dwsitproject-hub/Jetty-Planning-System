import DataHubFieldCue from './DataHubFieldCue.jsx'
import { CHARTER_TYPES, LAMBUNG_TYPES, VESSEL_TYPE_OPTIONS } from '../utils/masterVesselOptions'

function TextField({ id, label, value, onChange, saving, maxLength, placeholder, type = 'text', step, hint }) {
  return (
    <div className="modal__section">
      <label htmlFor={id} className="modal__label">{label}</label>
      {hint ? <p className="master-vessel-form__field-note">{hint}</p> : null}
      <input
        id={id}
        type={type}
        step={step}
        className="modal__input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={saving}
      />
    </div>
  )
}

function SelectField({ id, label, value, onChange, saving, options }) {
  return (
    <div className="modal__section">
      <label htmlFor={id} className="modal__label">{label}</label>
      <select
        id={id}
        className="modal__input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={saving}
      >
        <option value="">—</option>
        {options.map((opt) => (
          typeof opt === 'string'
            ? <option key={opt} value={opt}>{opt}</option>
            : <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  )
}

function CheckField({ id, label, checked, onChange, saving }) {
  return (
    <div className="modal__section">
      <label
        htmlFor={id}
        className="modal__checkbox-label"
        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={saving}
        />
        {label}
      </label>
    </div>
  )
}

/**
 * Master vessel fields. When highlightPlanningFields is set, the plan-critical
 * fields are grouped first and the remaining master fields are quiet.
 */
export default function MasterVesselFormFields({ form, setField, saving, highlightPlanningFields, planHint, neededTitle, neededHint, otherTitle, nameNotice = null }) {
  const hubCode = (
    <TextField
      id="vessel-hub-code"
      label={<DataHubFieldCue>Hub Code</DataHubFieldCue>}
      value={form.hubCode}
      onChange={(v) => setField('hubCode', v)}
      saving={saving}
      maxLength={50}
      placeholder="e.g. VSL-0001"
    />
  )
  const active = (
    <CheckField
      id="vessel-active"
      label="Active in Jetty Planning"
      checked={form.isActive !== false}
      onChange={(v) => setField('isActive', v)}
      saving={saving}
    />
  )
  const name = (
    <>
      <TextField
        id="vessel-name"
        label={<DataHubFieldCue>Vessel Name</DataHubFieldCue>}
        value={form.vesselName}
        onChange={(v) => setField('vesselName', v)}
        saving={saving}
        maxLength={120}
        placeholder="e.g. MT BIO EXPRESS"
      />
      {nameNotice}
    </>
  )
  const imo = (
    <TextField
      id="vessel-imo"
      label={<DataHubFieldCue>IMO</DataHubFieldCue>}
      value={form.vesselImo}
      onChange={(v) => setField('vesselImo', v)}
      saving={saving}
      maxLength={20}
    />
  )
  const mmsi = (
    <TextField
      id="vessel-mmsi"
      label={<DataHubFieldCue>MMSI</DataHubFieldCue>}
      value={form.vesselMmsi}
      onChange={(v) => setField('vesselMmsi', v)}
      saving={saving}
      maxLength={20}
    />
  )
  const sap = (
    <TextField
      id="vessel-sap"
      label={<DataHubFieldCue>SAP Code</DataHubFieldCue>}
      value={form.vesselCodeSap}
      onChange={(v) => setField('vesselCodeSap', v)}
      saving={saving}
      maxLength={60}
    />
  )
  const capacity = (
    <TextField
      id="vessel-capacity"
      label={<DataHubFieldCue>Capacity (MT)</DataHubFieldCue>}
      value={form.vesselCapacityMt}
      onChange={(v) => setField('vesselCapacityMt', v)}
      saving={saving}
      type="number"
      step="0.001"
    />
  )
  const gt = (
    <TextField
      id="vessel-gt"
      label={<DataHubFieldCue>Gross Tonnage</DataHubFieldCue>}
      value={form.vesselGrossTonnage}
      onChange={(v) => setField('vesselGrossTonnage', v)}
      saving={saving}
      type="number"
      step="0.001"
      hint={planHint}
    />
  )
  const draft = (
    <TextField
      id="vessel-draft"
      label={<DataHubFieldCue>Draft (m)</DataHubFieldCue>}
      value={form.vesselDraft}
      onChange={(v) => setField('vesselDraft', v)}
      saving={saving}
      type="number"
      step="0.01"
      hint={planHint}
    />
  )
  const loa = (
    <TextField
      id="vessel-loa"
      label={<DataHubFieldCue>Length Overall</DataHubFieldCue>}
      value={form.vesselLengthOverall}
      onChange={(v) => setField('vesselLengthOverall', v)}
      saving={saving}
      maxLength={40}
      placeholder="e.g. 79"
      hint={planHint}
    />
  )
  const vesselType = (
    <SelectField
      id="vessel-type"
      label={<DataHubFieldCue>Vessel Type</DataHubFieldCue>}
      value={form.vesselType}
      onChange={(v) => setField('vesselType', v)}
      saving={saving}
      options={VESSEL_TYPE_OPTIONS}
    />
  )
  const hull = (
    <SelectField
      id="vessel-lambung"
      label={<DataHubFieldCue>Hull Type</DataHubFieldCue>}
      value={form.typeLambung}
      onChange={(v) => setField('typeLambung', v)}
      saving={saving}
      options={LAMBUNG_TYPES}
    />
  )
  const charter = (
    <SelectField
      id="vessel-charter"
      label={<DataHubFieldCue>Charter Type</DataHubFieldCue>}
      value={form.typeCharter}
      onChange={(v) => setField('typeCharter', v)}
      saving={saving}
      options={CHARTER_TYPES}
    />
  )
  const heater = (
    <CheckField
      id="vessel-heater"
      label={<DataHubFieldCue>Heater</DataHubFieldCue>}
      checked={form.heater === true}
      onChange={(v) => setField('heater', v)}
      saving={saving}
    />
  )

  if (!highlightPlanningFields) {
    return (
      <>
        {hubCode}
        {active}
        {name}
        {imo}
        {mmsi}
        {sap}
        {capacity}
        {gt}
        {draft}
        {loa}
        {vesselType}
        {hull}
        {charter}
        {heater}
      </>
    )
  }

  return (
    <>
      <section className="master-vessel-form__needed" aria-labelledby="vessel-needed-title">
        <h3 id="vessel-needed-title" className="master-vessel-form__needed-title">{neededTitle}</h3>
        <p className="master-vessel-form__needed-hint">{neededHint}</p>
        {name}
        {loa}
        {gt}
        {draft}
        {vesselType}
        {hull}
        {imo}
        {mmsi}
      </section>
      <section aria-labelledby="vessel-other-title">
        <h3 id="vessel-other-title" className="master-vessel-form__other-title">{otherTitle}</h3>
        {hubCode}
        {active}
        {sap}
        {capacity}
        {charter}
        {heater}
      </section>
    </>
  )
}
