import { Request, Response } from 'express';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { FaultStatus } from '../../types';
import { deleteFiles } from '../../shared/services/storage.service';

export async function photoCleanup(req: Request, res: Response): Promise<void> {
  const secret = req.headers['x-cron-secret'];
  if (secret !== env.CRON_SECRET) {
    res.status(403).json({ success: false, error: 'Invalid cron secret' });
    return;
  }

  const photos = await prisma.faultPhoto.findMany({
    where: {
      deletedAt: null,
      fault: {
        status: FaultStatus.COMPLETED,
        completedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) },
      },
    },
    select: { id: true, r2Key: true },
  });

  if (photos.length === 0) {
    res.json({ success: true, data: { message: 'No photos to clean up', count: 0 } });
    return;
  }

  await deleteFiles(photos.map((p) => p.r2Key));

  await prisma.faultPhoto.updateMany({
    where: { id: { in: photos.map((p) => p.id) } },
    data: { deletedAt: new Date() },
  });

  res.json({ success: true, data: { message: `Cleaned up ${photos.length} photos`, count: photos.length } });
}
