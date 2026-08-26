/**
 * Export one or more canvases to a multi-page A4 PDF.
 * Scales each canvas to fit page width (no horizontal crop); packs sections
 * onto the same page when space remains, then paginates vertically if needed.
 *
 * @param {HTMLCanvasElement[]} canvases
 * @param {string} filename
 * @param {{ orientation?: 'landscape' | 'portrait', marginMm?: number, gapMm?: number }} [options]
 */
export async function downloadCanvasesAsPdf(canvases, filename, options = {}) {
  const valid = (canvases || []).filter(Boolean)
  if (valid.length === 0) throw new Error('downloadCanvasesAsPdf: no canvases provided')

  const orientation = options.orientation === 'portrait' ? 'portrait' : 'landscape'
  const marginMm = typeof options.marginMm === 'number' ? options.marginMm : 8
  const gapMm = typeof options.gapMm === 'number' ? options.gapMm : 4
  /** Prefer a new page if less than this remains and we already used the page. */
  const minUsefulMm = 24

  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4', compress: true })

  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const usableW = pageW - marginMm * 2
  const bottomLimit = pageH - marginMm

  let cursorY = marginMm
  let pageStarted = true

  function ensurePage() {
    if (!pageStarted) {
      pdf.addPage()
      pageStarted = true
      cursorY = marginMm
    }
  }

  function advancePage() {
    pdf.addPage()
    pageStarted = true
    cursorY = marginMm
  }

  for (let canvasIndex = 0; canvasIndex < valid.length; canvasIndex += 1) {
    const canvas = valid[canvasIndex]
    if (canvas.width <= 0 || canvas.height <= 0) continue

    const scale = usableW / canvas.width
    let srcY = 0

    while (srcY < canvas.height) {
      ensurePage()

      let availableMm = bottomLimit - cursorY
      if (availableMm < minUsefulMm && cursorY > marginMm + 0.5) {
        advancePage()
        availableMm = bottomLimit - cursorY
      }

      const maxSrcH = Math.max(1, Math.ceil(availableMm / scale))
      const srcH = Math.min(canvas.height - srcY, maxSrcH)
      if (srcH <= 0) break

      const slice = document.createElement('canvas')
      slice.width = canvas.width
      slice.height = srcH
      const ctx = slice.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, slice.width, slice.height)
      ctx.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH)

      const sliceHmm = srcH * scale
      const dataUrl = slice.toDataURL('image/jpeg', 0.92)
      pdf.addImage(dataUrl, 'JPEG', marginMm, cursorY, usableW, sliceHmm)

      cursorY += sliceHmm
      srcY += srcH

      if (srcY < canvas.height) {
        advancePage()
      }
    }

    // Small gap before the next section; stay on this page so the table can pack up.
    if (canvasIndex < valid.length - 1 && cursorY > marginMm) {
      cursorY += gapMm
    }
  }

  pdf.save(filename)
}
