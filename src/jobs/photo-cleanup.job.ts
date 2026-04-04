import cron from 'node-cron';
import { prisma } from '../config/prisma';
import { FaultStatus } from '../types';
import { deleteFiles } from '../shared/services/storage.service';

/**
 * Photo cleanup cron job — runs every 30 minutes.
 * Deletes R2 photos for faults where PDF has been generated (completed 30+ min ago).
 */
export function startPhotoCleanupJob(): void {
  cron.schedule('*/30 * * * *', async () => {
    console.log('[CRON] Running photo cleanup...');

    try {
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
        console.log('[CRON] No photos to clean up');
        return;
      }

      await deleteFiles(photos.map((p) => p.r2Key));

      await prisma.faultPhoto.updateMany({
        where: { id: { in: photos.map((p) => p.id) } },
        data: { deletedAt: new Date() },
      });

      console.log(`[CRON] Cleaned up ${photos.length} photos`);
    } catch (err) {
      console.error('[CRON] Photo cleanup failed:', err);
    }
  });

  console.log('[CRON] Photo cleanup job scheduled (every 30 minutes)');
}
