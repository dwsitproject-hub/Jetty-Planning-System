/**
 * Extract-only route for sampling quality reports (Pre-Checking SAMPLING autofill).
 * Mounted at POST /api/v1/sampling-document-extract.
 *
 * Nothing is stored here — the file itself is persisted through the sub-process document
 * upload when the operator saves the section. This endpoint serves files that are still
 * staged in the browser; use POST /sub-process-documents/:id/extract-sampling for files
 * that have already been saved.
 */
import express from 'express';
import multer from 'multer';
import { runSamplingDocumentExtract } from '../lib/sampling-document-extract.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

router.post('/', upload.single('file'), async (req, res) => {
  const buf = req.file?.buffer;
  if (!buf?.length) {
    return res.status(400).json({ error: 'No file uploaded (use form field name: file).' });
  }
  try {
    const out = await runSamplingDocumentExtract(buf);
    res.json(out);
  } catch (e) {
    const code = Number(e?.statusCode);
    const status = Number.isInteger(code) && code >= 400 && code < 500 ? code : 500;
    res.status(status).json({ error: e?.message || 'Extract failed' });
  }
});

export default router;
