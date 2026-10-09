/**
 * Shared widget drill-down. Optional column sort when modal.sortable is set.
 */
import { Fragment, useEffect, useMemo, useState } from 'react'
import { sortModalRows } from '../utils/widgetDetailSort.js'
import '../styles/modal.css'
import '../styles/management-dashboard.css'

function rowKey(row, i) {
  if (row?.id != null && row.productKey) return `${row.id}|${row.productKey}`
  return row?.id ?? row?._key ?? i
}

export default function WidgetDetailModal({ modal, onClose }) {
  const [sort, setSort] = useState(null)
  const [expandedKey, setExpandedKey] = useState(null)
  const sortIdentity = modal
    ? `${modal.title}|${modal.defaultSort?.key ?? ''}|${modal.defaultSort?.dir ?? ''}`
    : ''
  const expandable = typeof modal?.renderDetail === 'function'
  const expandColumn = modal?.expandColumn || 'vessel'

  useEffect(() => {
    if (!modal?.sortable) {
      setSort(null)
      return
    }
    setSort(modal.defaultSort ?? null)
  }, [sortIdentity, modal])

  useEffect(() => {
    setExpandedKey(null)
  }, [sortIdentity])

  const rows = useMemo(
    () => (modal?.sortable ? sortModalRows(modal.rows, modal.columns, sort) : (modal?.rows ?? [])),
    [modal, sort],
  )

  if (!modal) return null

  const toggleSort = (key) => {
    setSort((prev) => {
      if (prev?.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      return { key, dir: 'asc' }
    })
  }

  return (
    <div className="modal-overlay" onClick={onClose} aria-hidden="true">
      <div
        className="modal modal--wide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="widget-detail-modal-title"
        aria-modal="true"
      >
        <div className="mgmt-modal-header">
          <h2 id="widget-detail-modal-title" className="modal__title">{modal.title}</h2>
          <button type="button" className="mgmt-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        {modal.subtitle ? <p className="text-steel mgmt-sub" style={{ marginTop: 0 }}>{modal.subtitle}</p> : null}
        {modal.stats?.length ? (
          <div className="mgmt-modal-summary">
            {modal.stats.map((s) => (
              <div key={s.label} className="mgmt-modal-summary__item">
                <span className="mgmt-modal-summary__lbl">{s.label}</span>
                <span className="mgmt-modal-summary__val">{s.value}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {modal.columns.map((c) => {
                  const colKey = c.key || c.label
                  const active = modal.sortable && sort?.key === colKey
                  return (
                    <th key={colKey} className={c.align === 'right' ? 'mgmt-r' : ''}>
                      {modal.sortable && c.sortValue ? (
                        <button
                          type="button"
                          className="mgmt-modal-sort"
                          onClick={() => toggleSort(colKey)}
                          aria-label={`Sort by ${c.label}`}
                        >
                          {c.label}
                          <span aria-hidden="true">{active ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ' ⇅'}</span>
                        </button>
                      ) : c.label}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((row, i) => {
                const key = rowKey(row, i)
                const open = expandable && expandedKey === key
                return (
                  <Fragment key={key}>
                    <tr>
                      {modal.columns.map((c) => {
                        const colKey = c.key || c.label
                        return (
                          <td key={colKey} className={c.align === 'right' ? 'mgmt-r' : ''}>
                            {expandable && colKey === expandColumn ? (
                              <button
                                type="button"
                                className="mgmt-modal-vessel"
                                aria-expanded={open}
                                onClick={() => setExpandedKey(open ? null : key)}
                              >
                                {c.cell(row)}
                              </button>
                            ) : c.cell(row)}
                          </td>
                        )
                      })}
                    </tr>
                    {open ? (
                      <tr className="mgmt-detail">
                        <td colSpan={modal.columns.length}>{modal.renderDetail(row)}</td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              }) : (
                <tr><td colSpan={modal.columns.length} className="text-steel">{modal.emptyText || 'No voyages in this view.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {modal.footer ? <div className="mgmt-modal-foot">{modal.footer}</div> : null}
      </div>
    </div>
  )
}
