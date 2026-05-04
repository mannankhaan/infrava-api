import { Router } from 'express';
import { getFile } from '../../shared/services/storage.service';
import mime from 'mime-types';

const router = Router();

// Proxy files from R2 — serves photos, client logos, avatars, etc.
router.use(async (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();

  const key = req.path.startsWith('/') ? req.path.substring(1) : req.path;
  if (!key) return next();

  try {
    const buffer = await getFile(key);
    const contentType = mime.lookup(key) || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch {
    res.status(404).json({ success: false, error: 'File not found' });
  }
});

export default router;
