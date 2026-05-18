/**
 * Developer test page for the SI document OCR / extract API.
 * Route: /dev/ocr-test
 * Shows raw API response so we can confirm backend extract is working
 * before worrying about frontend field-merge logic.
 */
import { useState, useRef } from 'react'
import { extractShippingInstructionFromDocument } from '../api/shippingInstructions'
import { countSiExtractSignals } from '../utils/siExtractMerge'

const BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1').replace(/\/$/, '')

export default function DevOcrTest() {
  const inputRef = useRef(null)
  const [status, setStatus] = useState('idle') // idle | loading | done | error
  const [result, setResult] = useState(null)
  const [err, setErr] = useState(null)
  const [fileName, setFileName] = useState('')
  const [elapsed, setElapsed] = useState(null)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setStatus('loading')
    setResult(null)
    setErr(null)
    setElapsed(null)
    const t0 = Date.now()
    try {
      const out = await extractShippingInstructionFromDocument(file)
      setResult(out)
      setElapsed(Date.now() - t0)
      setStatus('done')
    } catch (ex) {
      setErr({ message: ex?.message, status: ex?.status, body: ex?.body })
      setElapsed(Date.now() - t0)
      setStatus('error')
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const signals = result?.fields ? countSiExtractSignals(result.fields) : 0

  return (
    <div style={{ maxWidth: 820, margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.25rem' }}>
        OCR / Extract test
      </h1>
      <p style={{ color: '#555', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        Calls <code>{BASE}/si-document-extract</code> with your file and shows the raw
        JSON response. Nothing is saved.
      </p>

      <label
        style={{
          display: 'inline-block',
          padding: '0.6rem 1.2rem',
          background: '#2563eb',
          color: '#fff',
          borderRadius: 6,
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: '0.9rem',
        }}
      >
        {status === 'loading' ? 'Processing…' : 'Choose PDF or image'}
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.tiff,.bmp"
          style={{ display: 'none' }}
          onChange={handleFile}
          disabled={status === 'loading'}
        />
      </label>

      {fileName && (
        <span style={{ marginLeft: '0.75rem', fontSize: '0.875rem', color: '#444' }}>{fileName}</span>
      )}

      {status === 'loading' && (
        <div style={{ marginTop: '1.5rem', color: '#2563eb', fontWeight: 500 }}>
          ⏳ Sending to API — OCR can take 20-60 s for the first run (Tesseract model download)…
        </div>
      )}

      {status === 'error' && (
        <div
          style={{
            marginTop: '1.5rem',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 6,
            padding: '1rem',
          }}
        >
          <p style={{ fontWeight: 700, color: '#991b1b', margin: 0 }}>
            ✗ Error {err?.status ? `(HTTP ${err.status})` : ''}
          </p>
          <p style={{ margin: '0.4rem 0 0', color: '#7f1d1d' }}>{err?.message}</p>
          {err?.body && (
            <pre
              style={{
                marginTop: '0.75rem',
                background: '#fff1f1',
                padding: '0.6rem',
                borderRadius: 4,
                fontSize: '0.78rem',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {JSON.stringify(err.body, null, 2)}
            </pre>
          )}
        </div>
      )}

      {status === 'done' && result && (
        <div style={{ marginTop: '1.5rem' }}>
          <div
            style={{
              background: signals > 0 ? '#ecfdf5' : '#fffbeb',
              border: `1px solid ${signals > 0 ? '#a7f3d0' : '#fde68a'}`,
              borderRadius: 6,
              padding: '0.75rem 1rem',
              marginBottom: '1rem',
            }}
          >
            <strong style={{ color: signals > 0 ? '#065f46' : '#92400e' }}>
              {signals > 0
                ? `✓ ${signals} signal group(s) detected — ${elapsed}ms`
                : `⚠ 0 signals detected — document processed but no SI fields found (${elapsed}ms)`}
            </strong>
          </div>

          {result.fields && (
            <section>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem' }}>Detected fields</h2>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '0.85rem',
                  marginBottom: '1.5rem',
                }}
              >
                <thead>
                  <tr style={{ background: '#f3f4f6' }}>
                    <th style={{ textAlign: 'left', padding: '0.4rem 0.6rem', border: '1px solid #e5e7eb' }}>Field</th>
                    <th style={{ textAlign: 'left', padding: '0.4rem 0.6rem', border: '1px solid #e5e7eb' }}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(result.fields)
                    .filter(([k]) => k !== 'breakdown')
                    .map(([k, v]) => (
                      <tr key={k}>
                        <td
                          style={{
                            padding: '0.35rem 0.6rem',
                            border: '1px solid #e5e7eb',
                            fontFamily: 'monospace',
                            color: '#374151',
                          }}
                        >
                          {k}
                        </td>
                        <td
                          style={{
                            padding: '0.35rem 0.6rem',
                            border: '1px solid #e5e7eb',
                            color: v ? '#111' : '#9ca3af',
                            fontStyle: v ? 'normal' : 'italic',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {v ?? '(null)'}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>

              {Array.isArray(result.fields.breakdown) && result.fields.breakdown.length > 0 && (
                <>
                  <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                    Breakdown rows ({result.fields.breakdown.length})
                  </h2>
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontSize: '0.8rem',
                      marginBottom: '1.5rem',
                    }}
                  >
                    <thead>
                      <tr style={{ background: '#f3f4f6' }}>
                        {['contractNo', 'poNo', 'soNo', 'qty', 'metricCode', 'commodityHint', 'remarks'].map(
                          (h) => (
                            <th
                              key={h}
                              style={{ textAlign: 'left', padding: '0.35rem 0.5rem', border: '1px solid #e5e7eb' }}
                            >
                              {h}
                            </th>
                          )
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {result.fields.breakdown.map((r, i) => (
                        <tr key={i}>
                          {['contractNo', 'poNo', 'soNo', 'qty', 'metricCode', 'commodityHint', 'remarks'].map(
                            (k) => (
                              <td
                                key={k}
                                style={{
                                  padding: '0.3rem 0.5rem',
                                  border: '1px solid #e5e7eb',
                                  color: r[k] ? '#111' : '#d1d5db',
                                  fontStyle: r[k] ? 'normal' : 'italic',
                                }}
                              >
                                {r[k] ?? '–'}
                              </td>
                            )
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </section>
          )}

          <details>
            <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: '#6b7280', marginBottom: '0.5rem' }}>
              Raw JSON response
            </summary>
            <pre
              style={{
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: 6,
                padding: '0.75rem',
                fontSize: '0.75rem',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  )
}
