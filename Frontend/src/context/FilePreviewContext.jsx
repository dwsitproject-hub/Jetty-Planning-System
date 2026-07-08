import { createContext, useCallback, useContext, useState } from 'react'
import FilePreviewModal from '../components/FilePreviewModal'

const FilePreviewContext = createContext(null)

export function FilePreviewProvider({ children }) {
  const [preview, setPreview] = useState(null)

  const openFilePreview = useCallback((opts) => {
    if (!opts?.url) return
    setPreview({
      url: opts.url,
      name: opts.name ?? null,
      mimeType: opts.mimeType ?? null,
    })
  }, [])

  const closeFilePreview = useCallback(() => setPreview(null), [])

  return (
    <FilePreviewContext.Provider value={{ openFilePreview, closeFilePreview }}>
      {children}
      {preview ? (
        <FilePreviewModal
          url={preview.url}
          name={preview.name}
          mimeType={preview.mimeType}
          onClose={closeFilePreview}
        />
      ) : null}
    </FilePreviewContext.Provider>
  )
}

export function useFilePreview() {
  const ctx = useContext(FilePreviewContext)
  if (!ctx) {
    throw new Error('useFilePreview must be used within FilePreviewProvider')
  }
  return ctx
}
