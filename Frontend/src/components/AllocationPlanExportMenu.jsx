import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function AllocationPlanExportMenu({ exporting, onExport }) {
  const { t: tAlloc } = useTranslation('allocation')
  const wrapRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState('jpg')
  const [orientation, setOrientation] = useState('landscape')
  const [includeSchematic, setIncludeSchematic] = useState(true)
  const [includeQueueTable, setIncludeQueueTable] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const canDownload = includeSchematic || includeQueueTable

  const handleDownload = useCallback(async () => {
    if (!canDownload || exporting) return
    setError(null)
    try {
      await onExport({ includeSchematic, includeQueueTable, format, orientation })
      setOpen(false)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : tAlloc('exportFailed', { defaultValue: 'Export failed. Please try again.' })
      )
    }
  }, [canDownload, exporting, format, includeSchematic, includeQueueTable, onExport, orientation, tAlloc])

  return (
    <div className="allocation-export-menu" ref={wrapRef}>
      <button
        type="button"
        className="btn btn--secondary jetty-schedule-gantt__export"
        onClick={() => setOpen((o) => !o)}
        disabled={exporting}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={tAlloc('exportButtonHint', {
          defaultValue: 'Export schematic and/or queue table as JPG or PDF',
        })}
      >
        {exporting
          ? tAlloc('exportExporting', { defaultValue: 'Exporting…' })
          : tAlloc('exportButton', { defaultValue: 'Export' })}
      </button>

      {open && !exporting ? (
        <div
          className="allocation-export-menu__panel"
          role="dialog"
          aria-labelledby="allocation-export-menu-title"
        >
          <h3 className="allocation-export-menu__title" id="allocation-export-menu-title">
            {tAlloc('exportMenuTitle', { defaultValue: 'Export' })}
          </h3>

          <fieldset className="allocation-export-menu__fieldset">
            <legend className="allocation-export-menu__legend">
              {tAlloc('exportFormat', { defaultValue: 'Format' })}
            </legend>
            <label className="allocation-export-menu__option allocation-export-menu__option--inline">
              <input
                type="radio"
                name="allocation-export-format"
                checked={format === 'jpg'}
                onChange={() => setFormat('jpg')}
              />
              <span>{tAlloc('exportFormatJpg', { defaultValue: 'JPG' })}</span>
            </label>
            <label className="allocation-export-menu__option allocation-export-menu__option--inline">
              <input
                type="radio"
                name="allocation-export-format"
                checked={format === 'pdf'}
                onChange={() => setFormat('pdf')}
              />
              <span>{tAlloc('exportFormatPdf', { defaultValue: 'PDF' })}</span>
            </label>
          </fieldset>

          {format === 'pdf' ? (
            <fieldset className="allocation-export-menu__fieldset">
              <legend className="allocation-export-menu__legend">
                {tAlloc('exportOrientation', { defaultValue: 'Orientation' })}
              </legend>
              <label className="allocation-export-menu__option allocation-export-menu__option--inline">
                <input
                  type="radio"
                  name="allocation-export-orientation"
                  checked={orientation === 'landscape'}
                  onChange={() => setOrientation('landscape')}
                />
                <span>{tAlloc('exportOrientationLandscape', { defaultValue: 'Landscape' })}</span>
              </label>
              <label className="allocation-export-menu__option allocation-export-menu__option--inline">
                <input
                  type="radio"
                  name="allocation-export-orientation"
                  checked={orientation === 'portrait'}
                  onChange={() => setOrientation('portrait')}
                />
                <span>{tAlloc('exportOrientationPortrait', { defaultValue: 'Portrait' })}</span>
              </label>
              <p className="allocation-export-menu__hint">
                {tAlloc('exportPdfHint', {
                  defaultValue: 'A4 page size. Content is scaled to fit without cropping.',
                })}
              </p>
            </fieldset>
          ) : null}

          <label className="allocation-export-menu__option">
            <input
              type="checkbox"
              checked={includeSchematic}
              onChange={(e) => setIncludeSchematic(e.target.checked)}
            />
            <span>{tAlloc('exportIncludeSchematic', { defaultValue: 'Include Schematic View' })}</span>
          </label>

          <label className="allocation-export-menu__option">
            <input
              type="checkbox"
              checked={includeQueueTable}
              onChange={(e) => setIncludeQueueTable(e.target.checked)}
            />
            <span>
              {tAlloc('exportIncludeQueueTable', {
                defaultValue: 'Include Incoming Vessel & Berthing Queue Table',
              })}
            </span>
          </label>

          {!canDownload ? (
            <p className="allocation-export-menu__hint" role="status">
              {tAlloc('exportSelectAtLeastOne', { defaultValue: 'Select at least one section to export.' })}
            </p>
          ) : null}

          {error ? (
            <p className="allocation-export-menu__error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="allocation-export-menu__actions">
            <button
              type="button"
              className="btn btn--primary btn--small"
              onClick={() => void handleDownload()}
              disabled={!canDownload}
            >
              {format === 'pdf'
                ? tAlloc('exportDownloadPdf', { defaultValue: 'Download PDF' })
                : tAlloc('exportDownloadJpg', { defaultValue: 'Download JPG' })}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
