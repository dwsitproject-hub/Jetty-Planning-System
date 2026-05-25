/**
 * Shared helpers for serving stored upload files inline (preview) or as attachment (download).
 */
import path from 'node:path';

const EXT_MIME = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export function mimeFromFilename(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  return EXT_MIME[ext] || 'application/octet-stream';
}

export function safeContentDispositionFilename(name) {
  const base = String(name || 'file').split(/[\\/]/).pop() || 'file';
  return base.replace(/[^\w.\-()+ ]/g, '_').slice(0, 120);
}

/** Serve file for in-browser preview (Content-Disposition: inline). */
export function sendStoredFileInline(res, fullPath, originalName, fallbackName) {
  const filename = safeContentDispositionFilename(originalName || fallbackName);
  const mime = mimeFromFilename(filename);
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  return res.sendFile(fullPath);
}

/** Serve file as download (Content-Disposition: attachment). */
export function sendStoredFileAttachment(res, fullPath, originalName, fallbackName) {
  return res.download(fullPath, originalName || fallbackName);
}
