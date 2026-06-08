/**
 * Authenticated access to legacy /uploads paths (C-01 bridge).
 * Base: /api/v1/stored-files
 */
import express from 'express';
import { assertStoredFileAccess } from '../lib/stored-file-access.js';
import { sendStoredFileAttachment, sendStoredFileInline } from '../lib/send-stored-file.js';

const router = express.Router();

async function serveStored(req, res, inline) {
  const pathParam = req.query.path;
  if (!pathParam || typeof pathParam !== 'string') {
    return res.status(400).json({ error: 'path query parameter is required' });
  }
  try {
    const { full, filename } = await assertStoredFileAccess(pathParam, req.selectedPortId);
    if (inline) {
      return sendStoredFileInline(res, full, filename, 'stored-file');
    }
    return sendStoredFileAttachment(res, full, filename, 'stored-file');
  } catch (e) {
    const status = e?.statusCode ?? 500;
    if (status >= 400 && status < 600) {
      return res.status(status).json({ error: e.message || 'Error' });
    }
    throw e;
  }
}

router.get('/view', async (req, res) => serveStored(req, res, true));
router.get('/download', async (req, res) => serveStored(req, res, false));

export default router;
