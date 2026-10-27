import { useMemo, useState } from 'react'
import MasterTablePagination from './MasterTablePagination.jsx'
import StickyFormOverlay from './StickyFormOverlay.jsx'
import { useMasterTablePagination } from '../hooks/useMasterTablePagination.js'
import '../styles/modal.css'
import '../styles/datahub-sync.css'

const FIELD_LABELS = {
  vessel_name: 'Vessel Name',
  vessel_imo: 'IMO',
  vessel_mmsi: 'MMSI',
  vessel_code_sap: 'SAP Code',
  vessel_capacity_mt: 'Capacity (MT)',
  vessel_gross_tonnage: 'Gross Tonnage',
  vessel_draft: 'Draft (m)',
  vessel_length_overall: 'LOA',
  vessel_type: 'Type',
  heater: 'Heater',
  type_lambung: 'Hull Type',
  type_charter: 'Charter Type',
  code: 'Term code',
  description: 'Description',
  name: 'Name',
  short_name: 'Short name',
  commodity_type: 'Type',
  kl_to_mt_factor: 'KL→MT factor',
  default_metric_id: 'Default unit',
  hs_code: 'HS code',
  material_code: 'Material code',
  hub_type: 'DataHub type',
  unlocode: 'UN/LOCODE',
  country: 'Country',
  is_active: 'Active',
  hub_site_id: 'Hub site (stored only)',
}

function displayValue(v) {
  if (v == null || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return String(v)
}

/** Resolve default_metric_id to metric.label (fallback code, then raw id). */
function formatFieldValue(column, v, metricLabelsById) {
  if (column === 'default_metric_id') {
    if (v == null || v === '') return '—'
    const id = Number(v)
    if (Number.isFinite(id) && metricLabelsById && metricLabelsById[id] != null) {
      return String(metricLabelsById[id])
    }
  }
  return displayValue(v)
}

function fieldLabel(column) {
  return FIELD_LABELS[column] || column
}

function formatNameConflictWarning(nameConflict) {
  const matches = nameConflict?.matches
  if (!Array.isArray(matches) || matches.length === 0) return null
  const bits = matches.slice(0, 3).map((m) => {
    const hub = m.hubCode ? `hub ${m.hubCode}` : m.id != null ? `JPS #${m.id}` : 'another row'
    return `${hub}${m.name ? ` (“${m.name}”)` : ''}`
  })
  const extra = matches.length > 3 ? ` +${matches.length - 3} more` : ''
  return `Same commodity long name as ${bits.join('; ')}${extra}. Unchecked by default — select to apply anyway.`
}

function isLocalUnchangedItem(item) {
  if (item?.diffKind !== 'unchanged') return false
  if (item?.hubCode) return false
  return item?.vesselId != null || item?.payload?.localOnly === true
}

function SyncReviewGroup({
  groupKey,
  title,
  hint,
  rows,
  selectedIds,
  onToggle,
  onSelectAll,
  applying,
  metricLabelsById,
  recordColumnLabel = 'Vessel',
}) {
  const {
    page,
    setPage,
    totalPages,
    pagedRows,
    range,
  } = useMasterTablePagination(rows)

  if (rows.length === 0) return null

  const allOn = rows.every((r) => selectedIds.has(r.id))

  return (
    <section className="datahub-sync__group">
      <div className="datahub-sync__group-head">
        <h3 className="datahub-sync__group-title">
          {title} <span className="text-steel">({rows.length})</span>
        </h3>
        <div className="datahub-sync__group-actions">
          <button
            type="button"
            className="btn btn--small btn--secondary"
            onClick={() => onSelectAll(!allOn)}
            disabled={applying}
          >
            {allOn ? 'Deselect all' : 'Select all'}
          </button>
        </div>
      </div>
      {hint ? <p className="text-steel datahub-sync__group-hint">{hint}</p> : null}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: '2.5rem' }} aria-label="Apply" />
              <th>{recordColumnLabel}</th>
              <th>Hub Code</th>
              <th>{groupKey === 'new' ? 'Incoming values' : 'Changes'}</th>
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((item) => {
              const diffEntries = Object.entries(item.fieldDiff || {})
              const conflictHint = formatNameConflictWarning(item.nameConflict)
              return (
                <tr key={item.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() => onToggle(item.id)}
                      disabled={applying}
                      aria-label={`Apply ${item.vesselName}`}
                    />
                  </td>
                  <td><strong>{item.vesselName}</strong></td>
                  <td className="text-steel">{item.hubCode || '—'}</td>
                  <td>
                    {conflictHint ? (
                      <p className="datahub-sync__name-conflict" role="note">
                        {conflictHint}
                      </p>
                    ) : null}
                    {item.applyError ? (
                      <p className="datahub-sync__apply-error" role="alert">
                        Last apply failed: {item.applyError}
                      </p>
                    ) : null}
                    {diffEntries.length === 0 ? (
                      <span className="text-steel">No field changes</span>
                    ) : (
                      <ul className="datahub-sync__diff">
                        {diffEntries.map(([column, change]) => (
                          <li key={column}>
                            <span className="datahub-sync__diff-field">{fieldLabel(column)}</span>
                            {groupKey === 'new' ? (
                              <span className="datahub-sync__diff-new">
                                {formatFieldValue(column, change.to, metricLabelsById)}
                              </span>
                            ) : (
                              <>
                                <span className="datahub-sync__diff-old">
                                  {formatFieldValue(column, change.from, metricLabelsById)}
                                </span>
                                <span className="datahub-sync__diff-arrow" aria-hidden="true">→</span>
                                <span className="datahub-sync__diff-new">
                                  {formatFieldValue(column, change.to, metricLabelsById)}
                                </span>
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <MasterTablePagination
        range={range}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        ariaLabel={`${title} pages`}
      />
    </section>
  )
}

function UnchangedList({ items, ariaLabel = 'Unchanged pages' }) {
  const { page, setPage, totalPages, pagedRows, range } = useMasterTablePagination(items)

  return (
    <>
      <ul className="datahub-sync__unchanged">
        {pagedRows.map((item) => (
          <li key={item.id} className="text-steel">
            {item.vesselName}
            {item.hubCode ? (
              <span className="text-steel"> ({item.hubCode})</span>
            ) : null}
          </li>
        ))}
      </ul>
      <MasterTablePagination
        range={range}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        ariaLabel={ariaLabel}
      />
    </>
  )
}

/**
 * Review a staged DataHub sync before anything is written to the master.
 * New and changed rows arrive pre-selected; unchanged rows cannot be selected
 * because there is nothing to write.
 */
export default function DataHubSyncReviewModal({
  run,
  items,
  applying = false,
  error = null,
  onApply,
  onDiscard,
  onClose,
  recordNoun = 'vessels',
  recordColumnLabel = 'Vessel',
  newHint = 'Vessels not yet in the JPS master.',
  metricLabelsById = null,
  showLocalUnchanged = false,
}) {
  const [selectedIds, setSelectedIds] = useState(() =>
    new Set((items || []).filter((i) => i.decision === 'approved' && i.diffKind !== 'unchanged').map((i) => i.id))
  )
  const [showUnchanged, setShowUnchanged] = useState(false)
  const [showLocalUnchangedList, setShowLocalUnchangedList] = useState(false)

  const groups = useMemo(() => {
    const all = Array.isArray(items) ? items : []
    const unchanged = all.filter((i) => i.diffKind === 'unchanged')
    return {
      changed: all.filter((i) => i.diffKind === 'changed'),
      new: all.filter((i) => i.diffKind === 'new'),
      unchanged: unchanged.filter((i) => !isLocalUnchangedItem(i)),
      localUnchanged: unchanged.filter((i) => isLocalUnchangedItem(i)),
    }
  }, [items])

  const nameConflictCount = useMemo(() => {
    if (run?.nameConflictCount != null) return Number(run.nameConflictCount)
    const all = Array.isArray(items) ? items : []
    return all.filter((i) => i.nameConflict?.matches?.length).length
  }, [items, run?.nameConflictCount])

  const toggle = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const setGroup = (group, on) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const item of groups[group]) {
        if (on) next.add(item.id)
        else next.delete(item.id)
      }
      return next
    })
  }

  return (
    <StickyFormOverlay>
      <div
        className="modal modal--wide modal--datahub-sync"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="datahub-sync-title"
        aria-modal="true"
      >
        <h2 id="datahub-sync-title" className="modal__title">
          Review DataHub sync #{run?.id}
          {run?.source === 'webhook' ? (
            <span className="master-hub-badge master-hub-badge--shared" style={{ marginLeft: '0.5rem', fontSize: '0.65em' }}>
              Webhook
            </span>
          ) : null}
          {run?.source === 'record' ? (
            <span className="master-hub-badge master-hub-badge--shared" style={{ marginLeft: '0.5rem', fontSize: '0.65em' }}>
              One record
            </span>
          ) : null}
        </h2>
        <p className="text-steel">
          {run?.hubRecordCount ?? 0} {recordNoun} read from DataHub: {run?.newCount ?? 0} new,{' '}
          {run?.changedCount ?? 0} changed, {run?.unchangedCount ?? 0} unchanged
          {run?.skippedNotUse > 0 ? (
            <>
              ; {run.skippedNotUse} hub {recordNoun} skipped (label contains &quot;(not use)&quot;)
            </>
          ) : null}
          {nameConflictCount > 0 ? (
            <>
              ; {nameConflictCount} with duplicate long name (unchecked — you can still apply them)
            </>
          ) : null}
          {showLocalUnchanged && groups.localUnchanged.length > 0 ? (
            <>
              ; {groups.localUnchanged.length} local-only {recordNoun} in JPS are not linked to DataHub
              and will not be changed
            </>
          ) : null}
          . Nothing is written until you apply.
        </p>

        {error && (
          <p style={{ color: 'var(--color-danger, #c00)' }} role="alert">
            {error}
          </p>
        )}

        <div className="modal__section datahub-sync__body">
          <SyncReviewGroup
            groupKey="changed"
            title="Changed"
            hint="DataHub values differ from the current master record."
            rows={groups.changed}
            selectedIds={selectedIds}
            onToggle={toggle}
            onSelectAll={(on) => setGroup('changed', on)}
            applying={applying}
            metricLabelsById={metricLabelsById}
            recordColumnLabel={recordColumnLabel}
          />
          <SyncReviewGroup
            groupKey="new"
            title="New"
            hint={newHint}
            rows={groups.new}
            selectedIds={selectedIds}
            onToggle={toggle}
            onSelectAll={(on) => setGroup('new', on)}
            applying={applying}
            metricLabelsById={metricLabelsById}
            recordColumnLabel={recordColumnLabel}
          />
          {showLocalUnchanged && groups.localUnchanged.length > 0 && (
            <section className="datahub-sync__group">
              <button
                type="button"
                className="btn btn--small btn--secondary"
                onClick={() => setShowLocalUnchangedList((v) => !v)}
              >
                {showLocalUnchangedList ? 'Hide' : 'Show'} local-only ({groups.localUnchanged.length})
              </button>
              <p className="text-steel datahub-sync__group-hint">
                These master rows have no hub code. Sync does not update or delete them.
              </p>
              {showLocalUnchangedList && (
                <UnchangedList
                  items={groups.localUnchanged}
                  ariaLabel="Local-only commodity pages"
                />
              )}
            </section>
          )}
          {groups.unchanged.length > 0 && (
            <section className="datahub-sync__group">
              <button
                type="button"
                className="btn btn--small btn--secondary"
                onClick={() => setShowUnchanged((v) => !v)}
              >
                {showUnchanged ? 'Hide' : 'Show'} unchanged hub-linked ({groups.unchanged.length})
              </button>
              {showUnchanged && (
                <UnchangedList items={groups.unchanged} ariaLabel="Unchanged hub-linked pages" />
              )}
            </section>
          )}
          {groups.changed.length === 0 && groups.new.length === 0 && (
            <p className="text-steel">
              The JPS master already matches DataHub. There is nothing to apply.
            </p>
          )}
        </div>

        <div className="modal__footer">
          <button type="button" className="btn btn--secondary" onClick={onClose} disabled={applying}>
            Close
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onDiscard}
            disabled={applying || run?.status !== 'staged'}
          >
            Discard run
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => onApply([...selectedIds])}
            disabled={applying || selectedIds.size === 0 || run?.status !== 'staged'}
          >
            {applying ? 'Applying…' : `Apply ${selectedIds.size} selected`}
          </button>
        </div>
      </div>
    </StickyFormOverlay>
  )
}
