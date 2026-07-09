import html2canvas from 'html2canvas'

const DEFAULT_CAPTURE_OPTIONS = {
  backgroundColor: '#ffffff',
  scale: 1.5,
  useCORS: true,
  logging: false,
  timeoutMs: 60000,
}

function waitForLayout() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}

/**
 * Capture a DOM node to a canvas using html2canvas.
 * @param {HTMLElement} node
 * @param {{ capturingClass?: string, expandWidth?: boolean, timeoutMs?: number }} options
 */
export async function captureElementToCanvas(node, options = {}) {
  if (!node) throw new Error('captureElementToCanvas: node is required')

  const {
    capturingClass = '',
    expandWidth = true,
    timeoutMs = DEFAULT_CAPTURE_OPTIONS.timeoutMs,
  } = options

  const prevWidth = node.style.width
  if (capturingClass) node.classList.add(capturingClass)

  if (expandWidth) {
    const scrollTarget = node.querySelector('.jetty-schematic-wrap') || node
    const fullWidth = Math.ceil((scrollTarget.scrollWidth || node.scrollWidth) + 16)
    node.style.width = `${fullWidth}px`
  }

  try {
    void node.offsetHeight
    await waitForLayout()

    const width = Math.ceil(node.scrollWidth)
    const height = Math.ceil(node.scrollHeight)

    const canvas = await Promise.race([
      html2canvas(node, {
        ...DEFAULT_CAPTURE_OPTIONS,
        width,
        height,
        windowWidth: width,
        windowHeight: height,
        scrollX: 0,
        scrollY: 0,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('export timed out')), timeoutMs)
      ),
    ])

    return canvas
  } finally {
    if (capturingClass) node.classList.remove(capturingClass)
    node.style.width = prevWidth
  }
}

/**
 * Stitch multiple canvases vertically onto one white canvas.
 * @param {HTMLCanvasElement[]} canvases
 * @param {number} gapPx
 */
export function stitchCanvasesVertically(canvases, gapPx = 16) {
  const valid = canvases.filter(Boolean)
  if (valid.length === 0) throw new Error('stitchCanvasesVertically: no canvases provided')
  if (valid.length === 1) return valid[0]

  const totalWidth = Math.max(...valid.map((c) => c.width))
  const totalHeight =
    valid.reduce((sum, c) => sum + c.height, 0) + gapPx * (valid.length - 1)

  const stitched = document.createElement('canvas')
  stitched.width = totalWidth
  stitched.height = totalHeight
  const ctx = stitched.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, totalWidth, totalHeight)

  let y = 0
  for (const canvas of valid) {
    ctx.drawImage(canvas, 0, y)
    y += canvas.height + gapPx
  }

  return stitched
}

/**
 * Download a canvas as a JPEG file.
 * @param {HTMLCanvasElement} canvas
 * @param {string} filename
 * @param {number} quality
 */
export async function downloadCanvasAsJpeg(canvas, filename, quality = 0.95) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) throw new Error('canvas.toBlob returned null')

  const objectUrl = URL.createObjectURL(blob)
  try {
    const link = document.createElement('a')
    link.download = filename
    link.href = objectUrl
    document.body.appendChild(link)
    link.click()
    link.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000)
  }
}
