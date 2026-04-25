import { Request, Response } from 'express';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { FaultStatus } from '../../types';
import { sendFaultCompletedEmail } from '../../shared/services/email.service';
import { deleteFiles } from '../../shared/services/storage.service';
import { generateFaultPdf } from '../../jobs/report.job';

export async function generateReport(req: Request, res: Response): Promise<void> {
  const secret = req.headers['x-cron-secret'];
  if (secret !== env.CRON_SECRET) {
    res.status(403).json({ success: false, error: 'Invalid cron secret' });
    return;
  }

  const faultId = req.params.faultId as string;

  const fault = await prisma.fault.findUnique({
    where: { id: faultId },
    include: {
      admin: { select: { id: true, name: true, email: true, avatarUrl: true, companyName: true, companyAddress: true, companyWebsite: true, companyPhone: true, companyEmail: true, companyAbn: true, logoUrl: true } },
      assignedOperative: { select: { name: true } },
      photos: { where: { deletedAt: null }, orderBy: { uploadedAt: 'asc' } },
      workDays: { include: { events: { orderBy: { timestamp: 'asc' } }, photos: { where: { deletedAt: null } } }, orderBy: { dayNumber: 'asc' } },
    },
  }) as any;

  if (!fault) {
    res.status(404).json({ success: false, error: 'Fault not found' });
    return;
  }

  try {
    const pdfR2Key = await generateFaultPdf(fault);

    await prisma.eodReport.create({
      data: {
        faultId: fault.id,
        adminId: fault.adminId,
        pdfR2Key,
        sentAt: new Date(),
      },
    });

    await prisma.fault.update({
      where: { id: faultId },
      data: { status: FaultStatus.COMPLETED, completedAt: new Date() },
    });

    // Email admin
    await sendFaultCompletedEmail({
      to: fault.admin.email,
      name: fault.admin.name,
      faultRef: fault.projectRef,
      faultTitle: fault.title,
    });

    res.json({ success: true, data: { message: 'Report generated', pdfR2Key } });
  } catch (err) {
    console.error('PDF generation error:', err);
    res.status(500).json({ success: false, error: 'PDF generation failed' });
  }
}

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
