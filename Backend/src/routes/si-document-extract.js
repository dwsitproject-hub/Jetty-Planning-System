/**
 * Standalone multipart route for OCR / PDF text SI draft autofill.
 * Mounted at POST /api/v1/si-document-extract (avoids any interaction with nested /shipping-instructions routes).
 */
import express from 'express';
import multer from 'multer';
import { runShippingInstructionDocumentExtract } from '../lib/si-document-extract.js';

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
    const out = await runShippingInstructionDocumentExtract(buf);
    res.json(out);
  } catch (e) {
    const code = Number(e?.statusCode);
    const status = Number.isInteger(code) && code >= 400 && code < 500 ? code : 500;
    res.status(status).json({ error: e?.message || 'Extract failed' });
  }
});

export default router;
