import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { AuthRequest, UserRole, FaultStatus } from '../../types';
import { findOrCreateUser, ApiError } from '../../shared/services/findOrCreateUser';
import { sendWelcomeAndTaskEmail, sendTaskNotificationEmail, sendFaultRejectedEmail, sendFaultCompletedEmail } from '../../shared/services/email.service';
import { parseFaultDocx } from '../../shared/services/docx-parser.service';
import { generateFaultPdf } from '../../jobs/report.job';
import { getFile } from '../../shared/services/storage.service';
import {
  AssignOperativeInput, ReassignInput, RejectInput,
  CreateOperativeInput, UpdateOperativeInput,
  CreateFaultInput, UpdateFaultInput as AdminUpdateFaultInput,
  ProcessDeletionInput,
  CreateQuotationInput, UpdateQuotationInput,
} from './admin.schemas';

// ─── Fault CRUD ─────────────────────────────────────────────────────

export async function createFault(req: AuthRequest, res: Response): Promise<void> {
  const input = req.body as CreateFaultInput;

  // Check uniqueness of clientRef
  const existing = await prisma.fault.findUnique({ where: { clientRef: input.clientRef } });
  if (existing) {
    res.status(400).json({ success: false, error: 'Client Reference already exists' });
    return;
  }

  const fault = await prisma.fault.create({
    data: {
      adminId: req.user!.id,
      createdBy: req.user!.id,
      clientRef: input.clientRef,
      companyRef: input.companyRef,
      title: input.title,
      workType: input.workType,
      description: input.description,
      locationText: input.locationText,
      locationLat: input.locationLat,
      locationLng: input.locationLng,
      timeAllocated: input.timeAllocated ? new Date(input.timeAllocated) : undefined,
      plannedArrival: input.plannedArrival ? new Date(input.plannedArrival) : undefined,
      plannedCompletion: input.plannedCompletion ? new Date(input.plannedCompletion) : undefined,
      priority: input.priority,
      onsiteContactName: input.onsiteContactName,
      onsiteContactPhone: input.onsiteContactPhone,
      onsiteContactEmail: input.onsiteContactEmail,
      visitTaskBriefing: input.visitTaskBriefing,
      visitLsr: input.visitLsr,
      visitLinkBlock: input.visitLinkBlock,
      visitSafeWorkPack: input.visitSafeWorkPack,
      visitPossession: input.visitPossession,
      visitTempWorks: input.visitTempWorks,
      visitIsolation: input.visitIsolation,
      visitTrackAccess: input.visitTrackAccess,
      visitTempWorksRequired: input.visitTempWorksRequired,
      visitWorkingAtHeight: input.visitWorkingAtHeight,
      contractorCompany: input.contractorCompany,
      contractorName: input.contractorName,
      contractorEmail: input.contractorEmail,
      contractorMobile: input.contractorMobile,
    },
  });

  await prisma.faultAuditLog.create({
    data: {
      faultId: fault.id,
      changedBy: req.user!.id,
      changeType: 'CREATED',
      newValue: { clientRef: fault.clientRef } as any,
    },
  });

  res.status(201).json({ success: true, data: fault });
}

export async function listFaults(req: AuthRequest, res: Response): Promise<void> {
  const { status, priority, search } = req.query as Record<string, string>;

  const where: Record<string, unknown> = { adminId: req.user!.id };
  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (search) {
    where.OR = [
      { clientRef: { contains: search, mode: 'insensitive' } },
      { title: { contains: search, mode: 'insensitive' } },
      { locationText: { contains: search, mode: 'insensitive' } },
    ];
  }

  const faults = await prisma.fault.findMany({
    where: where as any,
    include: {
      assignedOperative: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ success: true, data: faults });
}

export async function getFault(req: AuthRequest, res: Response): Promise<void> {
  const fault = await prisma.fault.findFirst({
    where: { id: req.params.id as string, adminId: req.user!.id },
    include: {
      admin: { select: { id: true, name: true, email: true } },
      assignedOperative: { select: { id: true, name: true, email: true } },
      photos: { where: { deletedAt: null }, orderBy: { uploadedAt: 'asc' } },
      workDays: { include: { events: { orderBy: { timestamp: 'asc' } } }, orderBy: { dayNumber: 'asc' } },
      auditLog: { orderBy: { changedAt: 'desc' }, take: 20, include: { user: { select: { name: true, role: true } } } },
    },
  });

  if (!fault) {
    res.status(404).json({ success: false, error: 'Fault not found' });
    return;
  }

  res.json({ success: true, data: fault });
}

export async function updateFault(req: AuthRequest, res: Response): Promise<void> {
  const faultId = req.params.id as string;
  const fault = await prisma.fault.findFirst({
    where: { id: faultId, adminId: req.user!.id },
  });

  if (!fault) {
    res.status(404).json({ success: false, error: 'Fault not found' });
    return;
  }

  if (fault.status !== FaultStatus.CREATED) {
    res.status(400).json({ success: false, error: 'Can only edit faults in CREATED status' });
    return;
  }

  const input = req.body as AdminUpdateFaultInput;
  const updateData: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (['timeAllocated', 'plannedArrival', 'plannedCompletion'].includes(key) && typeof value === 'string') {
      updateData[key] = new Date(value);
    } else {
      updateData[key] = value;
    }
  }

  const updated = await prisma.fault.update({
    where: { id: faultId },
    data: updateData as any,
  });

  res.json({ success: true, data: updated });
}

export async function deleteFault(req: AuthRequest, res: Response): Promise<void> {
  const faultId = req.params.id as string;
  const fault = await prisma.fault.findFirst({
    where: { id: faultId, adminId: req.user!.id },
  });

  if (!fault) {
    res.status(404).json({ success: false, error: 'Fault not found' });
    return;
  }

  if (fault.status !== FaultStatus.CREATED) {
    res.status(400).json({ success: false, error: 'Can only delete faults in CREATED status' });
    return;
  }

  await prisma.fault.delete({ where: { id: faultId } });
  res.json({ success: true, data: { message: 'Fault deleted' } });
}

// ─── DOCX Parse ─────────────────────────────────────────────────────

export async function parseDocx(req: AuthRequest, res: Response): Promise<void> {
  const file = (req as any).file;
  if (!file) {
    res.status(400).json({ success: false, error: 'No file uploaded' });
    return;
  }

  try {
    const parsed = await parseFaultDocx(file.buffer);
    res.json({ success: true, data: parsed });
  } catch (err) {
    console.error('DOCX parse error:', err);
    res.status(400).json({ success: false, error: 'Failed to parse DOCX file' });
  }
}

// ─── Fault Queue ────────────────────────────────────────────────────

export async function getQueue(req: AuthRequest, res: Response): Promise<void> {
  const { status } = req.query as Record<string, string>;

  const where: Record<string, unknown> = {
    adminId: req.user!.id,
  };
  if (status) where.status = status;

  const faults = await prisma.fault.findMany({
    where: where as any,
    include: {
      assignedOperative: { select: { id: true, name: true, email: true } },
      creator: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ success: true, data: faults });
}

export async function getQueueItem(req: AuthRequest, res: Response): Promise<void> {
  const fault = await prisma.fault.findFirst({
    where: {
      id: req.params.id as string,
      adminId: req.user!.id,
    },
    include: {
      admin: { select: { id: true, name: true, email: true } },
      creator: { select: { id: true, name: true, email: true } },
      assignedOperative: { select: { id: true, name: true, email: true } },
      photos: { where: { deletedAt: null }, orderBy: { uploadedAt: 'asc' } },
      workDays: { include: { events: { orderBy: { timestamp: 'asc' } }, photos: { where: { deletedAt: null }, orderBy: { uploadedAt: 'asc' } } }, orderBy: { dayNumber: 'asc' } },
      auditLog: { orderBy: { changedAt: 'desc' }, take: 20, include: { user: { select: { name: true, role: true } } } },
    },
  });

  if (!fault) {
    res.status(404).json({ success: false, error: 'Fault not found in your queue' });
    return;
  }

  res.json({ success: true, data: fault });
}

// ─── Assign / Reassign / Reject / Final Submit ─────────────────────

export async function assignOperative(req: AuthRequest, res: Response): Promise<void> {
  const { email } = req.body as AssignOperativeInput;

  const fault = await prisma.fault.findFirst({
    where: {
      id: req.params.id as string,
      adminId: req.user!.id,
    },
  });

  if (!fault) {
    res.status(404).json({ success: false, error: 'Fault not found' });
    return;
  }

  if (fault.status !== FaultStatus.CREATED) {
    res.status(400).json({ success: false, error: `Cannot assign operative when status is ${fault.status}` });
    return;
  }

  try {
    const { user: operative, isNew, tempPassword } = await findOrCreateUser(
      email, UserRole.OPERATIVE, req.user!.id, req.user!.email
    );

    await prisma.fault.update({
      where: { id: req.params.id as string },
      data: {
        assignedOperativeId: operative.id,
        status: FaultStatus.ASSIGNED_TO_OPERATIVE,
      },
    });

    await prisma.faultAuditLog.create({
      data: {
        faultId: req.params.id as string,
        changedBy: req.user!.id,
        changeType: 'ASSIGNED_TO_OPERATIVE',
        newValue: { operativeId: operative.id, operativeEmail: operative.email },
      },
    });

    const emailParams = {
      to: operative.email,
      name: operative.name,
      faultRef: fault.clientRef,
      faultTitle: fault.title,
      faultLocation: fault.locationText || '',
      priority: fault.priority || '',
      plannedCompletion: fault.plannedCompletion?.toISOString() || '',
    };

    if (isNew && tempPassword) {
      await sendWelcomeAndTaskEmail({ ...emailParams, tempPassword });
    } else {
      await sendTaskNotificationEmail(emailParams);
    }

    res.json({
      success: true,
      data: { message: `Fault assigned to ${operative.email}`, isNewAccount: isNew },
    });
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    throw err;
  }
}

export async function reassignOperative(req: AuthRequest, res: Response): Promise<void> {
  const { email, note } = req.body as ReassignInput;

  const fault = await prisma.fault.findFirst({
    where: {
      id: req.params.id as string,
      adminId: req.user!.id,
    },
  });

  if (!fault) {
    res.status(404).json({ success: false, error: 'Fault not found' });
    return;
  }

  const allowedStatuses: FaultStatus[] = [FaultStatus.ASSIGNED_TO_OPERATIVE, FaultStatus.OPERATIVE_SUBMITTED, FaultStatus.REJECTED];
  if (!allowedStatuses.includes(fault.status)) {
    res.status(400).json({ success: false, error: `Cannot reassign when status is ${fault.status}` });
    return;
  }

  try {
    const { user: operative, isNew, tempPassword } = await findOrCreateUser(
      email, UserRole.OPERATIVE, req.user!.id, req.user!.email
    );

    await prisma.fault.update({
      where: { id: req.params.id as string },
      data: {
        assignedOperativeId: operative.id,
        status: FaultStatus.REASSIGNED,
      },
    });

    await prisma.faultAuditLog.create({
      data: {
        faultId: req.params.id as string,
        changedBy: req.user!.id,
        changeType: 'REASSIGNED',
        oldValue: { previousOperativeId: fault.assignedOperativeId },
        newValue: { operativeId: operative.id, note },
      },
    });

    const emailParams = {
      to: operative.email,
      name: operative.name,
      faultRef: fault.clientRef,
      faultTitle: fault.title,
      faultLocation: fault.locationText || '',
      priority: fault.priority || '',
      plannedCompletion: fault.plannedCompletion?.toISOString() || '',
    };

    if (isNew && tempPassword) {
      await sendWelcomeAndTaskEmail({ ...emailParams, tempPassword });
    } else {
      await sendTaskNotificationEmail(emailParams);
    }

    res.json({ success: true, data: { message: `Fault reassigned to ${operative.email}` } });
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    throw err;
  }
}

export async function rejectFault(req: AuthRequest, res: Response): Promise<void> {
  const { rejectionNote } = req.body as RejectInput;

  const fault = await prisma.fault.findFirst({
    where: {
      id: req.params.id as string,
      adminId: req.user!.id,
    },
    include: {
      assignedOperative: { select: { name: true, email: true } },
    },
  });

  if (!fault) {
    res.status(404).json({ success: false, error: 'Fault not found' });
    return;
  }

  if (fault.status !== FaultStatus.OPERATIVE_SUBMITTED) {
    res.status(400).json({ success: false, error: 'Can only reject faults in OPERATIVE_SUBMITTED status' });
    return;
  }

  await prisma.fault.update({
    where: { id: req.params.id as string },
    data: { status: FaultStatus.REJECTED, rejectionNote },
  });

  await prisma.faultAuditLog.create({
    data: {
      faultId: req.params.id as string,
      changedBy: req.user!.id,
      changeType: 'REJECTED',
      newValue: { rejectionNote },
    },
  });

  // Notify operative about rejection
  if (fault.assignedOperative) {
    sendFaultRejectedEmail({
      to: fault.assignedOperative.email,
      name: fault.assignedOperative.name,
      faultRef: fault.clientRef,
      faultTitle: fault.title,
      rejectionNote: rejectionNote || '',
    }).catch((err) => console.error('Failed to send rejection email:', err));
  }

  res.json({ success: true, data: { message: 'Fault rejected and sent back to operative' } });
}

export async function finalSubmit(req: AuthRequest, res: Response): Promise<void> {
  const fault = await prisma.fault.findFirst({
    where: {
      id: req.params.id as string,
      adminId: req.user!.id,
    },
    include: {
      admin: { select: { id: true, name: true, email: true, avatarUrl: true } },
      assignedOperative: { select: { name: true } },
      photos: { where: { deletedAt: null } },
      workDays: { include: { events: true, photos: { where: { deletedAt: null } } }, orderBy: { dayNumber: 'asc' } },
    },
  });

  if (!fault) {
    res.status(404).json({ success: false, error: 'Fault not found' });
    return;
  }

  if (fault.status !== FaultStatus.OPERATIVE_SUBMITTED) {
    res.status(400).json({ success: false, error: 'Can only final-submit faults in OPERATIVE_SUBMITTED status' });
    return;
  }

  await prisma.fault.update({
    where: { id: req.params.id as string },
    data: { status: FaultStatus.COMPLETED, adminSubmittedAt: new Date(), completedAt: new Date() },
  });

  await prisma.faultAuditLog.create({
    data: {
      faultId: req.params.id as string,
      changedBy: req.user!.id,
      changeType: 'ADMIN_SUBMITTED',
    },
  });

  // Auto-generate report
  try {
    const r2Key = await generateFaultPdf(fault);
    await prisma.eodReport.create({
      data: {
        faultId: fault.id,
        adminId: fault.adminId,
        pdfR2Key: r2Key,
        sentAt: new Date(),
      },
    });
  } catch (err) {
    // Log but don't fail the submission
    console.error('Report generation failed:', err);
  }

  // Send completion email to admin
  sendFaultCompletedEmail({
    to: fault.admin.email,
    name: fault.admin.name,
    faultRef: fault.clientRef,
    faultTitle: fault.title,
  }).catch((err) => console.error('Failed to send completion email:', err));

  res.json({ success: true, data: { message: 'Fault completed and report generated.' } });
}

export async function downloadReport(req: AuthRequest, res: Response): Promise<void> {
  const report = await prisma.eodReport.findFirst({
    where: {
      id: req.params.id as string,
      adminId: req.user!.id,
    },
    include: { fault: { select: { clientRef: true } } },
  });

  if (!report || !report.pdfR2Key) {
    res.status(404).json({ success: false, error: 'Report not found' });
    return;
  }

  try {
    const buffer = await getFile(report.pdfR2Key);
    const filename = `Infrava-Report-${report.fault?.clientRef || 'report'}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch {
    res.status(404).json({ success: false, error: 'Report file not found' });
  }
}

// ─── Operative Management ───────────────────────────────────────────

export async function listOperatives(req: AuthRequest, res: Response): Promise<void> {
  const operatives = await prisma.user.findMany({
    where: { adminId: req.user!.id, role: UserRole.OPERATIVE, isActive: true },
    select: {
      id: true, name: true, email: true, lastLoginAt: true, createdAt: true,
      operativeAssignedFaults: {
        where: { status: { not: FaultStatus.COMPLETED } },
        select: { id: true, clientRef: true, title: true, status: true },
        take: 1,
      },
    },
  });

  const data = operatives.map((o) => ({
    id: o.id,
    name: o.name,
    email: o.email,
    lastLoginAt: o.lastLoginAt,
    createdAt: o.createdAt,
    currentFault: o.operativeAssignedFaults[0] || null,
  }));

  res.json({ success: true, data });
}

export async function createOperative(req: AuthRequest, res: Response): Promise<void> {
  const { name, email, password } = req.body as CreateOperativeInput;

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (existing) {
    res.status(400).json({ success: false, error: 'Email already in use' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS);
  const operative = await prisma.user.create({
    data: {
      name,
      email: email.toLowerCase().trim(),
      passwordHash,
      role: UserRole.OPERATIVE,
      adminId: req.user!.id,
    },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  res.status(201).json({ success: true, data: operative });
}

export async function updateOperative(req: AuthRequest, res: Response): Promise<void> {
  const id = req.params.id as string;
  const data = req.body as UpdateOperativeInput;

  const operative = await prisma.user.findFirst({
    where: { id, adminId: req.user!.id, role: UserRole.OPERATIVE },
  });
  if (!operative) {
    res.status(404).json({ success: false, error: 'Operative not found' });
    return;
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      ...(data.name && { name: data.name }),
      ...(data.email && { email: data.email.toLowerCase().trim() }),
    },
    select: { id: true, name: true, email: true, role: true },
  });

  res.json({ success: true, data: updated });
}

export async function deleteOperative(req: AuthRequest, res: Response): Promise<void> {
  const id = req.params.id as string;

  const operative = await prisma.user.findFirst({
    where: { id, adminId: req.user!.id, role: UserRole.OPERATIVE },
  });
  if (!operative) {
    res.status(404).json({ success: false, error: 'Operative not found' });
    return;
  }

  await prisma.user.update({ where: { id }, data: { isActive: false } });
  res.json({ success: true, data: { message: 'Operative deactivated' } });
}

// ─── Analytics ──────────────────────────────────────────────────────

export async function getAnalytics(req: AuthRequest, res: Response): Promise<void> {
  const adminId = req.user!.id;

  const [total, byStatus, byPriority, overdue, completedCount, byWorkType] = await Promise.all([
    prisma.fault.count({ where: { adminId } }),
    prisma.fault.groupBy({ by: ['status'], where: { adminId }, _count: true }),
    prisma.fault.groupBy({ by: ['priority'], where: { adminId }, _count: true }),
    prisma.fault.count({
      where: {
        adminId,
        status: { notIn: [FaultStatus.COMPLETED] },
        plannedCompletion: { lt: new Date() },
      },
    }),
    prisma.fault.count({ where: { adminId, status: FaultStatus.COMPLETED } }),
    prisma.fault.groupBy({ by: ['workType'], where: { adminId }, _count: true }),
  ]);

  // Completed faults for avg completion time
  const completedFaults = await prisma.fault.findMany({
    where: { adminId, status: FaultStatus.COMPLETED, completedAt: { not: null } },
    select: { createdAt: true, completedAt: true },
  });

  let avgCompletionDays = 0;
  if (completedFaults.length > 0) {
    const totalDays = completedFaults.reduce((sum, f) => {
      const days = (f.completedAt!.getTime() - f.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      return sum + days;
    }, 0);
    avgCompletionDays = Math.round((totalDays / completedFaults.length) * 10) / 10;
  }

  // Work day hours (PUNCH_IN to PUNCH_OUT)
  const workDaysWithEvents = await prisma.workDay.findMany({
    where: { fault: { adminId }, isLocked: true },
    include: { events: { orderBy: { timestamp: 'asc' } } },
  });

  let totalHoursAllDays = 0;
  let daysWithHours = 0;
  for (const wd of workDaysWithEvents) {
    const punchIn = wd.events.find((e) => e.eventType === 'PUNCH_IN');
    const punchOut = wd.events.find((e) => e.eventType === 'PUNCH_OUT');
    if (punchIn && punchOut) {
      const hours = (punchOut.timestamp.getTime() - punchIn.timestamp.getTime()) / (1000 * 60 * 60);
      totalHoursAllDays += hours;
      daysWithHours++;
    }
  }
  const avgDailyHoursWorked = daysWithHours > 0
    ? Math.round((totalHoursAllDays / daysWithHours) * 10) / 10
    : 0;

  // Per-operative stats
  const operatives = await prisma.user.findMany({
    where: { adminId, role: 'OPERATIVE', isActive: true },
    select: { id: true, name: true },
  });

  const operativeStats = await Promise.all(
    operatives.map(async (op) => {
      const [assigned, completed, rejected] = await Promise.all([
        prisma.fault.count({ where: { adminId, assignedOperativeId: op.id } }),
        prisma.fault.count({ where: { adminId, assignedOperativeId: op.id, status: FaultStatus.COMPLETED } }),
        prisma.fault.count({
          where: {
            adminId,
            assignedOperativeId: op.id,
            auditLog: { some: { changeType: 'REJECTED' } },
          },
        }),
      ]);

      // Operative's completed faults for avg completion
      const opCompleted = await prisma.fault.findMany({
        where: { adminId, assignedOperativeId: op.id, status: FaultStatus.COMPLETED, completedAt: { not: null } },
        select: { createdAt: true, completedAt: true },
      });
      let opAvgDays = 0;
      if (opCompleted.length > 0) {
        const totalD = opCompleted.reduce((s, f) => s + (f.completedAt!.getTime() - f.createdAt.getTime()) / (1000 * 60 * 60 * 24), 0);
        opAvgDays = Math.round((totalD / opCompleted.length) * 10) / 10;
      }

      // Operative's work day hours
      const opWorkDays = await prisma.workDay.findMany({
        where: { fault: { adminId, assignedOperativeId: op.id }, isLocked: true },
        include: { events: { orderBy: { timestamp: 'asc' } } },
      });

      let opTotalHours = 0;
      let opDaysWorked = 0;
      for (const wd of opWorkDays) {
        const pIn = wd.events.find((e) => e.eventType === 'PUNCH_IN');
        const pOut = wd.events.find((e) => e.eventType === 'PUNCH_OUT');
        if (pIn && pOut) {
          opTotalHours += (pOut.timestamp.getTime() - pIn.timestamp.getTime()) / (1000 * 60 * 60);
          opDaysWorked++;
        }
      }

      const submitted = assigned > 0 ? assigned : 1; // avoid division by zero
      return {
        operativeId: op.id,
        name: op.name,
        faultsAssigned: assigned,
        faultsCompleted: completed,
        avgCompletionDays: opAvgDays,
        totalHoursWorked: Math.round(opTotalHours * 10) / 10,
        totalDaysWorked: opDaysWorked,
        rejectionRate: Math.round((rejected / submitted) * 100),
      };
    })
  );

  res.json({
    success: true,
    data: {
      total,
      completed: completedCount,
      overdue,
      avgCompletionDays,
      avgDailyHoursWorked,
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
      byPriority: byPriority.map((p) => ({ priority: p.priority || 'Unset', count: p._count })),
      byWorkType: byWorkType.map((w) => ({ workType: w.workType || 'Unset', count: w._count })),
      operativeStats,
    },
  });
}

// ─── Reports ────────────────────────────────────────────────────────

export async function listReports(req: AuthRequest, res: Response): Promise<void> {
  const reports = await prisma.eodReport.findMany({
    where: { adminId: req.user!.id },
    include: {
      fault: { select: { clientRef: true, title: true, status: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ success: true, data: reports });
}

// ─── Audit Logs ─────────────────────────────────────────────────────

export async function listAuditLogs(req: AuthRequest, res: Response): Promise<void> {
  const logs = await prisma.faultAuditLog.findMany({
    where: { fault: { adminId: req.user!.id } },
    include: {
      fault: { select: { clientRef: true, title: true } },
      user: { select: { name: true, role: true } },
    },
    orderBy: { changedAt: 'desc' },
    take: 100,
  });

  res.json({ success: true, data: logs });
}

// ─── GDPR Deletion Requests ────────────────────────────────────────

export async function listDeletionRequests(req: AuthRequest, res: Response): Promise<void> {
  const requests = await prisma.dataDeletionRequest.findMany({
    where: {
      target: { adminId: req.user!.id },
    },
    include: {
      requester: { select: { name: true, email: true } },
      target: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ success: true, data: requests });
}

export async function processDeletionRequest(req: AuthRequest, res: Response): Promise<void> {
  const id = req.params.id as string;
  const { status, note } = req.body as ProcessDeletionInput;

  const request = await prisma.dataDeletionRequest.findFirst({
    where: { id, target: { adminId: req.user!.id } },
  });

  if (!request) {
    res.status(404).json({ success: false, error: 'Deletion request not found' });
    return;
  }

  if (request.status !== 'PENDING') {
    res.status(400).json({ success: false, error: 'Request already processed' });
    return;
  }

  await prisma.dataDeletionRequest.update({
    where: { id },
    data: {
      status,
      processedBy: req.user!.id,
      processedAt: new Date(),
      reason: note || request.reason,
    },
  });

  // If approved, deactivate the target user
  if (status === 'APPROVED') {
    await prisma.user.update({
      where: { id: request.targetUserId },
      data: { isActive: false },
    });
  }

  res.json({ success: true, data: { message: `Deletion request ${status.toLowerCase()}` } });
}

// ─── Quotations (Addons) ───────────────────────────────────────────

export async function createQuotation(req: AuthRequest, res: Response): Promise<void> {
  const { title, workDescription, status, items } = req.body as CreateQuotationInput;

  const quotation = await prisma.quotation.create({
    data: {
      adminId: req.user!.id,
      title,
      workDescription,
      status: status || 'DRAFT',
      items: {
        create: items.map((item, i) => ({
          itemNo: i + 1,
          type: item.type,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          rate: item.rate,
          amount: Math.round(item.quantity * item.rate * 100) / 100,
        })),
      },
    },
    include: { items: { orderBy: { itemNo: 'asc' } } },
  });

  res.status(201).json({ success: true, data: quotation });
}

export async function listQuotations(req: AuthRequest, res: Response): Promise<void> {
  const quotations = await prisma.quotation.findMany({
    where: { adminId: req.user!.id },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  });

  const data = quotations.map((q) => ({
    ...q,
    grandTotal: q.items.reduce((sum, item) => sum + item.amount, 0),
    itemCount: q.items.length,
  }));

  res.json({ success: true, data });
}

export async function getQuotation(req: AuthRequest, res: Response): Promise<void> {
  const quotation = await prisma.quotation.findFirst({
    where: { id: req.params.id as string, adminId: req.user!.id },
    include: { items: { orderBy: { itemNo: 'asc' } } },
  });

  if (!quotation) {
    res.status(404).json({ success: false, error: 'Quotation not found' });
    return;
  }

  const grandTotal = quotation.items.reduce((sum, item) => sum + item.amount, 0);
  res.json({ success: true, data: { ...quotation, grandTotal } });
}

export async function updateQuotation(req: AuthRequest, res: Response): Promise<void> {
  const quotation = await prisma.quotation.findFirst({
    where: { id: req.params.id as string, adminId: req.user!.id },
  });

  if (!quotation) {
    res.status(404).json({ success: false, error: 'Quotation not found' });
    return;
  }

  if (quotation.status === 'FINAL') {
    res.status(400).json({ success: false, error: 'Cannot edit a finalized quotation' });
    return;
  }

  const { title, workDescription, status, items } = req.body as UpdateQuotationInput;

  await prisma.$transaction(async (tx) => {
    await tx.quotation.update({
      where: { id: quotation.id },
      data: {
        ...(title !== undefined && { title }),
        ...(workDescription !== undefined && { workDescription }),
        ...(status !== undefined && { status }),
      },
    });

    if (items !== undefined) {
      await tx.quotationItem.deleteMany({ where: { quotationId: quotation.id } });
      await tx.quotationItem.createMany({
        data: items.map((item, i) => ({
          quotationId: quotation.id,
          itemNo: i + 1,
          type: item.type,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          rate: item.rate,
          amount: Math.round(item.quantity * item.rate * 100) / 100,
        })),
      });
    }
  });

  const updated = await prisma.quotation.findUnique({
    where: { id: quotation.id },
    include: { items: { orderBy: { itemNo: 'asc' } } },
  });

  res.json({ success: true, data: updated });
}

export async function deleteQuotation(req: AuthRequest, res: Response): Promise<void> {
  const quotation = await prisma.quotation.findFirst({
    where: { id: req.params.id as string, adminId: req.user!.id },
  });

  if (!quotation) {
    res.status(404).json({ success: false, error: 'Quotation not found' });
    return;
  }

  if (quotation.status === 'FINAL') {
    res.status(400).json({ success: false, error: 'Cannot delete a finalized quotation' });
    return;
  }

  await prisma.quotation.delete({ where: { id: quotation.id } });
  res.json({ success: true, data: { message: 'Quotation deleted' } });
}
