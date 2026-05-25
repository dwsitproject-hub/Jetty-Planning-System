import { useFilePreview } from '../context/FilePreviewContext'

/**
 * Clickable file name that opens the shared preview modal.
 * @param {{
 *   url: string,
 *   name?: string,
 *   mimeType?: string | null,
 *   className?: string,
 *   children?: import('react').ReactNode,
 *   title?: string,
 * }} props
 */
export default function FilePreviewLink({ url, name, mimeType, className, children, title }) {
  const { openFilePreview } = useFilePreview()

  if (!url) {
    return <span className={className}>{children ?? name}</span>
  }

  return (
    <button
      type="button"
      className={className || 'file-preview-link'}
      title={title}
      onClick={() => openFilePreview({ url, name, mimeType })}
    >
      {children ?? name}
    </button>
  )
}
