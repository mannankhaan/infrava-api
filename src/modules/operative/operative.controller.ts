import { Response } from 'express';
import { prisma } from '../../config/prisma';
import { AuthRequest, FaultStatus } from '../../types';
import { uploadFile, deleteFile } from '../../shared/services/storage.service';
import { sendFaultSubmittedEmail } from '../../shared/services/email.service';
import { UpdateFaultInput, UpdateWorkDayInput, PunchEventInput, DeletionRequestInput } from './operative.schemas';

export async function listClients(req: AuthRequest, res: Response): Promise<void> {
  const faults = await prisma.fault.findMany({
    where: { assignedOperativeId: req.user!.id, clientId: { not: null } },
    select: {
      clientId: true,
      status: true,
      client: { select: { id: true, name: true, logoR2Key: true } },
    },
  });

  const actionable: string[] = [FaultStatus.ASSIGNED_TO_OPERATIVE, FaultStatus.REJECTED, FaultStatus.REASSIGNED];
  const clientMap = new Map<string, { id: string; name: string; logoR2Key: string | null; activeFaults: number; totalFaults: number }>();

  for (const f of faults) {
    if (!f.clientId || !f.client) continue;
    const existing = clientMap.get(f.clientId);
    if (existing) {
      existing.totalFaults++;
      if (actionable.includes(f.status)) existing.activeFaults++;
    } else {
      clientMap.set(f.clientId, {
        id: f.client.id,
        name: f.client.name,
        logoR2Key: f.client.logoR2Key,
        totalFaults: 1,
        activeFaults: actionable.includes(f.status) ? 1 : 0,
      });
    }
  }

  res.json({ success: true, data: Array.from(clientMap.values()) });
}

export async function listFaults(req: AuthRequest, res: Response): Promise<void> {
  const clientId = req.query.clientId as string | undefined;
  const faults = await prisma.fault.findMany({
    where: {
      assignedOperativeId: req.user!.id,
      ...(clientId && { clientId }),
    },
    include: {
      creator: { select: { name: true } },
      admin: { select: { name: true, email: true } },
      client: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ success: true, data: faults });
}

export async function getFault(req: AuthRequest, res: Response): Promise<void> {
  const fault = await prisma.fault.findFirst({
    where: { id: req.params.id as string, assignedOperativeId: req.user!.id },
    include: {
      creator: { select: { name: true } },
      admin: { select: { name: true, email: true } },
      client: { select: { id: true, name: true } },
      formTemplate: { select: { id: true, name: true, schema: true } },
      photos: { where: { deletedAt: null, workDayId: null }, orderBy: { uploadedAt: 'asc' } },
      workDays: {
        include: {
          events: { orderBy: { timestamp: 'asc' } },
          photos: { where: { deletedAt: null }, orderBy: { uploadedAt: 'asc' } },
        },
        orderBy: { dayNumber: 'asc' },
      },
    },
  });

  if (!fault) {
    res.status(404).json({ success: false, error: 'Project not found' });
    return;
  }

  res.json({ success: true, data: fault });
}

export async function updateFault(req: AuthRequest, res: Response): Promise<void> {
  const fault = await prisma.fault.findFirst({
    where: { id: req.params.id as string, assignedOperativeId: req.user!.id },
  });

  if (!fault) {
    res.status(404).json({ success: false, error: 'Project not found' });
    return;
  }

  const editable: FaultStatus[] = [FaultStatus.ASSIGNED_TO_OPERATIVE, FaultStatus.REJECTED, FaultStatus.REASSIGNED];
  if (!editable.includes(fault.status)) {
    res.status(400).json({ success: false, error: `Cannot edit fault in ${fault.status} status` });
    return;
  }

  const input = req.body as UpdateFaultInput;
  const updated = await prisma.fault.update({
    where: { id: req.params.id as string },
    data: {
      ...(input.supervisorNames !== undefined && { supervisorNames: input.supervisorNames }),
      ...(input.operativeName !== undefined && { operativeName: input.operativeName }),
      ...(input.materialsUsed !== undefined && { materialsUsed: input.materialsUsed }),
      ...(input.methodology !== undefined && { methodology: input.methodology }),
      ...(input.worksDescription !== undefined && { worksDescription: input.worksDescription }),
      ...(input.dimensions !== undefined && { dimensions: input.dimensions }),
      ...(input.furtherWork !== undefined && { furtherWork: input.furtherWork }),
      ...(input.furtherWorkNotes !== undefined && { furtherWorkNotes: input.furtherWorkNotes }),
    },
  });

  res.json({ success: true, data: updated });
}

export async function submitFault(req: AuthRequest, res: Response): Promise<void> {
  const fault = await prisma.fault.findFirst({
    where: { id: req.params.id as string, assignedOperativeId: req.user!.id },
    include: {
      admin: { select: { name: true, email: true } },
      assignedOperative: { select: { name: true } },
    },
  });

  if (!fault) {
    res.status(404).json({ success: false, error: 'Project not found' });
    return;
  }

  const submittable: FaultStatus[] = [FaultStatus.ASSIGNED_TO_OPERATIVE, FaultStatus.REJECTED, FaultStatus.REASSIGNED];
  if (!submittable.includes(fault.status)) {
    res.status(400).json({ success: false, error: `Cannot submit fault in ${fault.status} status` });
    return;
  }

  await prisma.fault.update({
    where: { id: req.params.id as string },
    data: { status: FaultStatus.OPERATIVE_SUBMITTED, operativeSubmittedAt: new Date(), rejectionNote: null },
  });

  await prisma.faultAuditLog.create({
    data: {
      faultId: req.params.id as string,
      changedBy: req.user!.id,
      changeType: 'OPERATIVE_SUBMITTED',
    },
  });

  // Notify admin that fault is ready for review
  if (fault.admin) {
    sendFaultSubmittedEmail({
      to: fault.admin.email,
      adminName: fault.admin.name,
      operativeName: fault.assignedOperative?.name || 'Operative',
      faultRef: fault.projectRef,
      faultTitle: fault.title,
    }).catch((err) => console.error('Failed to send submission email:', err));
  }

  res.json({ success: true, data: { message: 'Project submitted to Admin for review' } });
}

// ─── Photo Management ───────────────────────────────────────────────

export async function uploadPhoto(req: AuthRequest, res: Response): Promise<void> {
  const fault = await prisma.fault.findFirst({
    where: { id: req.params.id as string, assignedOperativeId: req.user!.id },
  });

  if (!fault) {
    res.status(404).json({ success: false, error: 'Project not found' });
    return;
  }

  const file = req.file;
  if (!file) {
    res.status(400).json({ success: false, error: 'No photo uploaded' });
    return;
  }

  const photoStage = (req.body.photoStage || '').toLowerCase() as 'before' | 'during' | 'after';
  if (!['before', 'during', 'after'].includes(photoStage)) {
    res.status(400).json({ success: false, error: 'Invalid photo stage' });
    return;
  }

  const existingCount = await prisma.faultPhoto.count({
    where: { faultId: req.params.id as string, photoStage, deletedAt: null },
  });
  if (existingCount >= 10) {
    res.status(400).json({ success: false, error: `Maximum 10 ${photoStage} photos allowed` });
    return;
  }

  const r2Key = `photos/${fault.id}/${photoStage}/${Date.now()}-${file.originalname}`;
  await uploadFile(r2Key, file.buffer);

  const workDayId = req.body.workDayId || null;
  const photo = await prisma.faultPhoto.create({
    data: {
      faultId: req.params.id as string,
      r2Key,
      photoStage,
      fileName: file.originalname,
      fileSizeBytes: file.size,
      ...(workDayId && { workDayId }),
    },
  });

  res.status(201).json({ success: true, data: photo });
}

export async function deletePhoto(req: AuthRequest, res: Response): Promise<void> {
  const fault = await prisma.fault.findFirst({
    where: { id: req.params.id as string, assignedOperativeId: req.user!.id },
  });

  if (!fault) {
    res.status(404).json({ success: false, error: 'Project not found' });
    return;
  }

  const editable: FaultStatus[] = [FaultStatus.ASSIGNED_TO_OPERATIVE, FaultStatus.REJECTED, FaultStatus.REASSIGNED];
  if (!editable.includes(fault.status)) {
    res.status(400).json({ success: false, error: 'Cannot delete photos after submission' });
    return;
  }

  const photo = await prisma.faultPhoto.findFirst({
    where: { id: req.params.pid as string, faultId: req.params.id as string, deletedAt: null },
  });

  if (!photo) {
    res.status(404).json({ success: false, error: 'Photo not found' });
    return;
  }

  await prisma.faultPhoto.update({
    where: { id: req.params.pid as string },
    data: { deletedAt: new Date() },
  });

  await deleteFile(photo.r2Key);

  res.json({ success: true, data: { message: 'Photo deleted' } });
}

// ─── Work Days & Punch Events ───────────────────────────────────────

export async function addWorkDay(req: AuthRequest, res: Response): Promise<void> {
  const faultId = req.params.id as string;
  const fault = await prisma.fault.findFirst({
    where: { id: faultId, assignedOperativeId: req.user!.id },
  });

  if (!fault) {
    res.status(404).json({ success: false, error: 'Project not found' });
    return;
  }

  const editable: FaultStatus[] = [FaultStatus.ASSIGNED_TO_OPERATIVE, FaultStatus.REJECTED, FaultStatus.REASSIGNED];
  if (!editable.includes(fault.status)) {
    res.status(400).json({ success: false, error: `Cannot add work day in ${fault.status} status` });
    return;
  }

  // Get next day number
  const lastDay = await prisma.workDay.findFirst({
    where: { faultId },
    orderBy: { dayNumber: 'desc' },
  });

  // Ensure previous day is locked before starting a new one
  // Exception: when GPS tracking is disabled, days are auto-locked on save
  if (lastDay && !lastDay.isLocked) {
    let gpsDisabled = false;
    if (fault.formTemplateId) {
      const template = await prisma.formTemplate.findFirst({
        where: { id: fault.formTemplateId },
        select: { schema: true },
      });
      const opSections = (template?.schema as Record<string, unknown>)?.operativeSections as string[] | undefined;
      if (opSections && !opSections.includes('gpsTracking')) gpsDisabled = true;
    }
    if (!gpsDisabled) {
      res.status(400).json({ success: false, error: 'Previous work day must be completed (punched out) before starting a new one' });
      return;
    }
  }

  const dayNumber = (lastDay?.dayNumber || 0) + 1;

  const workDay = await prisma.workDay.create({
    data: { faultId, dayNumber },
    include: { events: true },
  });

  res.status(201).json({ success: true, data: workDay });
}

const PUNCH_SEQUENCE = ['PUNCH_IN', 'REACHED', 'WORK_DONE', 'PUNCH_OUT'] as const;

export async function recordPunchEvent(req: AuthRequest, res: Response): Promise<void> {
  const faultId = req.params.id as string;
  const workDayId = req.params.dayId as string;

  const fault = await prisma.fault.findFirst({
    where: { id: faultId, assignedOperativeId: req.user!.id },
  });

  if (!fault) {
    res.status(404).json({ success: false, error: 'Project not found' });
    return;
  }

  const workDay = await prisma.workDay.findFirst({
    where: { id: workDayId, faultId },
    include: { events: { orderBy: { timestamp: 'asc' } } },
  });

  if (!workDay) {
    res.status(404).json({ success: false, error: 'Work day not found' });
    return;
  }

  if (workDay.isLocked) {
    res.status(400).json({ success: false, error: 'Work day is already locked (punched out)' });
    return;
  }

  const input = req.body as PunchEventInput;

  // Validate sequence
  const existingTypes = workDay.events.map((e) => e.eventType);
  const expectedIndex = existingTypes.length;
  const expectedType = PUNCH_SEQUENCE[expectedIndex];

  if (!expectedType) {
    res.status(400).json({ success: false, error: 'All punch events for this day have been recorded' });
    return;
  }

  if (input.eventType !== expectedType) {
    res.status(400).json({
      success: false,
      error: `Expected ${expectedType} but received ${input.eventType}. Punch events must follow the sequence: ${PUNCH_SEQUENCE.join(' → ')}`,
    });
    return;
  }

  const event = await prisma.punchEvent.create({
    data: {
      workDayId,
      eventType: input.eventType,
      lat: input.lat,
      lng: input.lng,
    },
  });

  // Lock the day on PUNCH_OUT
  if (input.eventType === 'PUNCH_OUT') {
    await prisma.workDay.update({
      where: { id: workDayId },
      data: { isLocked: true },
    });
  }

  res.status(201).json({ success: true, data: event });
}

// ─── Update Work Day Form Data ─────────────────────────────────────

export async function updateWorkDay(req: AuthRequest, res: Response): Promise<void> {
  const faultId = req.params.id as string;
  const workDayId = req.params.dayId as string;

  const fault = await prisma.fault.findFirst({
    where: { id: faultId, assignedOperativeId: req.user!.id },
  });

  if (!fault) {
    res.status(404).json({ success: false, error: 'Project not found' });
    return;
  }

  const editable: FaultStatus[] = [FaultStatus.ASSIGNED_TO_OPERATIVE, FaultStatus.REJECTED, FaultStatus.REASSIGNED];
  if (!editable.includes(fault.status)) {
    res.status(400).json({ success: false, error: `Cannot edit in ${fault.status} status` });
    return;
  }

  const workDay = await prisma.workDay.findFirst({
    where: { id: workDayId, faultId },
  });

  if (!workDay) {
    res.status(404).json({ success: false, error: 'Work day not found' });
    return;
  }

  // Check if GPS tracking is disabled — if so, auto-lock the day on save
  let autoLock = false;
  if (!workDay.isLocked) {
    const template = await prisma.formTemplate.findFirst({
      where: { id: fault.formTemplateId ?? undefined },
      select: { schema: true },
    });
    const opSections = (template?.schema as Record<string, unknown>)?.operativeSections as string[] | undefined;
    if (opSections && !opSections.includes('gpsTracking')) {
      autoLock = true;
    }
  }

  const input = req.body as UpdateWorkDayInput;
  const updated = await prisma.workDay.update({
    where: { id: workDayId },
    data: {
      ...(input.supervisorNames !== undefined && { supervisorNames: input.supervisorNames }),
      ...(input.tradespersonNames !== undefined && { tradespersonNames: input.tradespersonNames }),
      ...(input.operativeName !== undefined && { operativeName: input.operativeName }),
      ...(input.materialsUsed !== undefined && { materialsUsed: input.materialsUsed as any }),
      ...(input.methodology !== undefined && { methodology: input.methodology }),
      ...(input.worksDescription !== undefined && { worksDescription: input.worksDescription }),
      ...(input.dimensions !== undefined && { dimensions: input.dimensions as any }),
      ...(input.tempWorks !== undefined && { tempWorks: input.tempWorks as any }),
      ...(input.furtherWork !== undefined && { furtherWork: input.furtherWork }),
      ...(input.furtherWorkNotes !== undefined && { furtherWorkNotes: input.furtherWorkNotes }),
      ...(autoLock && { isLocked: true }),
    },
    include: {
      events: { orderBy: { timestamp: 'asc' } },
      photos: { where: { deletedAt: null }, orderBy: { uploadedAt: 'asc' } },
    },
  });

  res.json({ success: true, data: updated });
}

/* ── Data Deletion Request ─────────────────────────────────── */

export async function requestDeletion(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { reason } = req.body as DeletionRequestInput;

  // Check if there's already a pending request
  const existing = await prisma.dataDeletionRequest.findFirst({
    where: { targetUserId: userId, status: 'PENDING' },
  });

  if (existing) {
    res.status(400).json({ success: false, error: 'You already have a pending deletion request' });
    return;
  }

  const request = await prisma.dataDeletionRequest.create({
    data: {
      requestedBy: userId,
      targetUserId: userId,
      reason,
    },
  });

  res.status(201).json({ success: true, data: request });
}
