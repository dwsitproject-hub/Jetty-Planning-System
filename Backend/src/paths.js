/**
 * Resolve backend root and upload directory regardless of process.cwd()
 * (fixes missing static files when the API is started from the monorepo root).
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Directory containing Backend/package.json (the `Backend` folder). */
export const BACKEND_ROOT = path.resolve(__dirname, '..');

/** Uploaded assets root (overridable for deployment). */
export const UPLOAD_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(BACKEND_ROOT, 'uploads');
