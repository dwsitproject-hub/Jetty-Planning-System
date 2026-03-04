import { useState } from 'react'
import { dryCertStatus, vessels } from '../data/mockData'

export default function Verification() {
  const [signed, setSigned] = useState(dryCertStatus.status === 'CLEAN')
  const [tankStatus, setTankStatus] = useState('CLEAN')

  const canSail = tankStatus === 'CLEAN' && signed

  return (
    <div>
      <h1 className="page-title">Verification (Dry Certificate)</h1>

      <section className="card">
        <h2 className="card__title">Dry Certificate — {vessels['v-bg-mulia-vii']?.vesselName ?? 'Vessel'}</h2>
        <p style={{ color: 'var(--color-text-steel)', marginBottom: 'var(--spacing-4)', fontSize: 'var(--font-size-small)' }}>
          Mark tanks CLEAN and sign. Vessel Sailed is locked until Dry Cert is CLEAN.
        </p>
        <div className="input-group">
          <label>Tank inspection status</label>
          <select
            value={tankStatus}
            onChange={(e) => setTankStatus(e.target.value)}
            style={{ maxWidth: '200px' }}
          >
            <option value="PENDING">PENDING</option>
            <option value="CLEAN">CLEAN</option>
          </select>
        </div>
        <div className="input-group">
          <label>
            <input
              type="checkbox"
              checked={signed}
              onChange={(e) => setSigned(e.target.checked)}
            />
            {' '}I confirm tanks are clean (digital sign)
          </label>
        </div>
        <div className="verification-status" style={{ marginTop: 'var(--spacing-4)', padding: 'var(--spacing-3)', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)' }}>
          <strong>Vessel Sailed:</strong>{' '}
          {canSail ? (
            <span style={{ color: 'var(--color-primary)' }}>Unlocked — can be set to Sailed</span>
          ) : (
            <span style={{ color: 'var(--color-text-steel)' }}>Locked until Dry Cert is CLEAN and signed</span>
          )}
        </div>
      </section>
    </div>
  )
}
