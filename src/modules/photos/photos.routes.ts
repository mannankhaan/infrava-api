import { Router } from 'express';
import { prisma } from '../../config/prisma';
import { getPresignedUploadUrl } from '../../shared/services/storage.service';
import { env } from '../../config/env';

const router = Router();

// Simple redirect or proxy for photos
// The frontend currently expects /api/v1/photos/:key
// Catch-all middleware for the photos router
router.use(async (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  
  const key = req.path.startsWith('/') ? req.path.substring(1) : req.path;
  
  if (!key) return next();
  
  // If we are in dev and key doesn't start with photos/, it might be a local path
  // but the R2 keys usually start with photos/ or admin-faults/
  
  // Construct the R2 public URL
  const publicUrl = `https://pub-${env.R2_ACCOUNT_ID}.r2.dev/${key}`;
  
  // Redirect to the public R2 URL
  res.redirect(publicUrl);
});

export default router;
