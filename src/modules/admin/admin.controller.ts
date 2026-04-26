import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { AuthRequest, UserRole, FaultStatus, ManagerPermissions } from '../../types';
import { findOrCreateUser, ApiError } from '../../shared/services/findOrCreateUser';
import { sendWelcomeAndTaskEmail, sendTaskNotificationEmail, sendFaultRejectedEmail, sendFaultCompletedEmail } from '../../shared/services/email.service';
import { parseFaultDocx } from '../../shared/services/docx-parser.service';
import { generateFaultPdf } from '../../jobs/report.job';
import { generateQuotationPdf } from '../../jobs/quotation-pdf.job';
import { getFile } from '../../shared/services/storage.service';
import {
  AssignOperativeInput, ReassignInput, RejectInput,
  CreateOperativeInput, UpdateOperativeInput,
  CreateFaultInput, UpdateFaultInput as AdminUpdateFaultInput,
  ProcessDeletionInput, AdminPresignPhotoInput,
  CreateRateCardInput, UpdateRateCardInput,
  CreateQuotationInput, UpdateQuotationInput,
  CreateClientInput, UpdateClientInput,
  CreateManagerInput, UpdateManagerPermissionsInput,
  CreateTemplateInput, UpdateTemplateInput,
} from './admin.schemas';
import { getPresignedUploadUrl } from '../../shared/services/storage.service';
import { validateFaultAgainstTemplate, separateFormData } from '../../shared/services/form-validator.service';
import { resolveUniquePrefix, createProjectSequence, generateProjectRef } from '../../shared/services/project-sequence.service';
import { createQuotationSequence, generateQuotationRef } from '../../shared/services/quotation-sequence.service';

/** Resolve the effective admin ID — for managers it's their adminId, for admins it's their own id */
function getAdminId(req: AuthRequest): string {
  if (req.user!.role === UserRole.MANAGER) return req.user!.adminId!;
  return req.user!.id;
}

/** For managers with client-scoped permissions, add clientId filter to queries */
function getClientScopeFilter(req: AuthRequest): { clientId?: { in: string[] } } | {} {
  if (req.user!.role === UserRole.MANAGER && req.user!.permissions) {
    const perms = req.user!.permissions as ManagerPermissions;
    if (perms.clients.length > 0 && perms.clients[0] !== '*') {
      return { clientId: { in: perms.clients } };
    }
  }
  return {};
}

// ─── Fault CRUD ─────────────────────────────────────────────────────

export async function createFault(req: AuthRequest, res: Response): Promise<void> {
  const input = req.body as CreateFaultInput;
  const adminId = getAdminId(req);

  // clientId is required for projectRef generation
  if (!input.clientId) {
    res.status(400).json({ success: false, error: 'Client is required' });
    return;
  }

  // If client has a template, validate against it
  const client = await prisma.client.findFirst({
    where: { id: input.clientId, adminId },
    include: { formTemplate: true },
  });

  if (!client) {
    res.status(404).json({ success: false, error: 'Client not found' });
    return;
  }

  if (client.formTemplate && client.formTemplate.isActive) {
    const schema = client.formTemplate.schema as any;
    const allData: Record<string, unknown> = { ...input, ...(input.customFields || {}) };
    const validation = validateFaultAgainstTemplate(allData, schema);
    if (!validation.valid) {
      res.status(400).json({ success: false, error: validation.errors.join(', ') });
      return;
    }
  }

  // Auto-generate projectRef atomically (e.g. "NR-0001")
  const projectRef = await generateProjectRef(input.clientId);

  const fault = await prisma.fault.create({
    data: {
      adminId,
      createdBy: req.user!.id,
      clientId: input.clientId,
      projectRef,
      clientRef: input.clientRef || undefined,
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
      formTemplateId: input.formTemplateId,
      customFields: input.customFields ? (input.customFields as any) : undefined,
      ...(input.photos && input.photos.length > 0 ? {
        photos: {
          create: input.photos.map(p => ({
            r2Key: p.r2Key,
            fileName: p.fileName,
            fileSizeBytes: p.fileSizeBytes,
            photoStage: 'before'
          }))
        }
      } : {}),
    },
  });

  await prisma.faultAuditLog.create({
    data: {
      faultId: fault.id,
      changedBy: req.user!.id,
      changeType: 'CREATED',
      newValue: { projectRef: fault.projectRef } as any,
    },
  });

  res.status(201).json({ success: true, data: fault });
}

export async function listFaults(req: AuthRequest, res: Response): Promise<void> {
  const { status, priority, search, clientId } = req.query as Record<string, string>;

  const where: Record<string, unknown> = { adminId: getAdminId(req), ...getClientScopeFilter(req) };
  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (clientId) where.clientId = clientId === 'none' ? null : clientId;
  if (search) {
    where.OR = [
      { projectRef: { contains: search, mode: 'insensitive' } },
      { clientRef: { contains: search, mode: 'insensitive' } },
      { title: { contains: search, mode: 'insensitive' } },
      { locationText: { contains: search, mode: 'insensitive' } },
    ];
  }

  const faults = await prisma.fault.findMany({
    where: where as any,
    include: {
      assignedOperative: { select: { id: true, name: true, email: true } },
      client: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ success: true, data: faults });
}

export async function getFault(req: AuthRequest, res: Response): Promise<void> {
  const fault = await prisma.fault.findFirst({
    where: { id: req.params.id as string, adminId: getAdminId(req) },
    include: {
      admin: { select: { id: true, name: true, email: true } },
      client: { select: { id: true, name: true } },
      assignedOperative: { select: { id: true, name: true, email: true } },
      formTemplate: { select: { id: true, name: true, schema: true } },
      photos: { where: { deletedAt: null }, orderBy: { uploadedAt: 'asc' } },
      workDays: { include: { events: { orderBy: { timestamp: 'asc' } } }, orderBy: { dayNumber: 'asc' } },
      auditLog: { orderBy: { changedAt: 'desc' }, take: 20, include: { user: { select: { name: true, role: true } } } },
    },
  });

  if (!fault) {
    res.status(404).json({ success: false, error: 'Project not found' });
    return;
  }

  res.json({ success: true, data: fault });
}

export async function updateFault(req: AuthRequest, res: Response): Promise<void> {
  const faultId = req.params.id as string;
  const fault = await prisma.fault.findFirst({
    where: { id: faultId, adminId: getAdminId(req) },
  });

  if (!fault) {
    res.status(404).json({ success: false, error: 'Project not found' });
    return;
  }

  if (fault.status !== FaultStatus.CREATED) {
    res.status(400).json({ success: false, error: 'Can only edit projects in CREATED status' });
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
    where: { id: faultId, adminId: getAdminId(req) },
  });

  if (!fault) {
    res.status(404).json({ success: false, error: 'Project not found' });
    return;
  }

  if (fault.status !== FaultStatus.CREATED) {
    res.status(400).json({ success: false, error: 'Can only delete projects in CREATED status' });
    return;
  }

  await prisma.fault.delete({ where: { id: faultId } });
  res.json({ success: true, data: { message: 'Project deleted' } });
}

export async function adminPresignPhoto(req: AuthRequest, res: Response): Promise<void> {
  const { contentType, fileName } = req.body as AdminPresignPhotoInput;
  const uniqueId = `file_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const cleanName = fileName ? fileName.replace(/[^a-zA-Z0-9.-]/g, '_') : 'upload';
  const r2Key = `admin-faults/${uniqueId}-${cleanName}`;
  const { url } = await getPresignedUploadUrl(r2Key, contentType);
  res.json({ success: true, data: { uploadUrl: url, r2Key } });
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
  const { status, clientId } = req.query as Record<string, string>;

  const where: Record<string, unknown> = {
    adminId: getAdminId(req),
    ...getClientScopeFilter(req),
  };
  if (status) where.status = status;
  if (clientId) where.clientId = clientId === 'none' ? null : clientId;

  const faults = await prisma.fault.findMany({
    where: where as any,
    include: {
      assignedOperative: { select: { id: true, name: true, email: true } },
      creator: { select: { id: true, name: true, email: true } },
      client: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ success: true, data: faults });
}

export async function getQueueItem(req: AuthRequest, res: Response): Promise<void> {
  const fault = await prisma.fault.findFirst({
    where: {
      id: req.params.id as string,
      adminId: getAdminId(req),
    },
    include: {
      admin: { select: { id: true, name: true, email: true } },
      client: { select: { id: true, name: true } },
      creator: { select: { id: true, name: true, email: true } },
      assignedOperative: { select: { id: true, name: true, email: true } },
      formTemplate: { select: { id: true, name: true, schema: true } },
      photos: { where: { deletedAt: null }, orderBy: { uploadedAt: 'asc' } },
      workDays: { include: { events: { orderBy: { timestamp: 'asc' } }, photos: { where: { deletedAt: null }, orderBy: { uploadedAt: 'asc' } } }, orderBy: { dayNumber: 'asc' } },
      auditLog: { orderBy: { changedAt: 'desc' }, take: 20, include: { user: { select: { name: true, role: true } } } },
    },
  });

  if (!fault) {
    res.status(404).json({ success: false, error: 'Project not found in your queue' });
    return;
  }

  res.json({ success: true, data: fault });
}

// ─── Assign / Reassign / Reject / Final Submit ─────────────────────

export async function assignOperative(req: AuthRequest, res: Response): Promise<void> {
  const { email } = req.body as AssignOperativeInput;
  const adminId = getAdminId(req);

  const fault = await prisma.fault.findFirst({
    where: {
      id: req.params.id as string,
      adminId,
    },
  });

  if (!fault) {
    res.status(404).json({ success: false, error: 'Project not found' });
    return;
  }

  if (fault.status !== FaultStatus.CREATED) {
    res.status(400).json({ success: false, error: `Cannot assign operative when status is ${fault.status}` });
    return;
  }

  try {
    const { user: operative, isNew, tempPassword } = await findOrCreateUser(
      email, UserRole.OPERATIVE, adminId, req.user!.email
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
      faultRef: fault.projectRef,
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
  const adminId = getAdminId(req);

  const fault = await prisma.fault.findFirst({
    where: {
      id: req.params.id as string,
      adminId,
    },
  });

  if (!fault) {
    res.status(404).json({ success: false, error: 'Project not found' });
    return;
  }

  const allowedStatuses: FaultStatus[] = [FaultStatus.ASSIGNED_TO_OPERATIVE, FaultStatus.OPERATIVE_SUBMITTED, FaultStatus.REJECTED];
  if (!allowedStatuses.includes(fault.status)) {
    res.status(400).json({ success: false, error: `Cannot reassign when status is ${fault.status}` });
    return;
  }

  try {
    const { user: operative, isNew, tempPassword } = await findOrCreateUser(
      email, UserRole.OPERATIVE, adminId, req.user!.email
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
      faultRef: fault.projectRef,
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
      adminId: getAdminId(req),
    },
    include: {
      assignedOperative: { select: { name: true, email: true } },
    },
  });

  if (!fault) {
    res.status(404).json({ success: false, error: 'Project not found' });
    return;
  }

  if (fault.status !== FaultStatus.OPERATIVE_SUBMITTED) {
    res.status(400).json({ success: false, error: 'Can only reject projects in OPERATIVE_SUBMITTED status' });
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
      faultRef: fault.projectRef,
      faultTitle: fault.title,
      rejectionNote: rejectionNote || '',
    }).catch((err) => console.error('Failed to send rejection email:', err));
  }

  res.json({ success: true, data: { message: 'Project rejected and sent back to operative' } });
}

export async function finalSubmit(req: AuthRequest, res: Response): Promise<void> {
  const fault = await prisma.fault.findFirst({
    where: {
      id: req.params.id as string,
      adminId: getAdminId(req),
    },
    include: {
      admin: { select: { id: true, name: true, email: true, avatarUrl: true, companyName: true, companyAddress: true, companyWebsite: true, companyPhone: true, companyEmail: true, companyAbn: true, logoUrl: true } },
      assignedOperative: { select: { name: true } },
      photos: { where: { deletedAt: null } },
      workDays: { include: { events: true, photos: { where: { deletedAt: null } } }, orderBy: { dayNumber: 'asc' } },
    },
  });

  if (!fault) {
    res.status(404).json({ success: false, error: 'Project not found' });
    return;
  }

  if (fault.status !== FaultStatus.OPERATIVE_SUBMITTED) {
    res.status(400).json({ success: false, error: 'Can only final-submit projects in OPERATIVE_SUBMITTED status' });
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
    faultRef: fault.projectRef,
    faultTitle: fault.title,
  }).catch((err) => console.error('Failed to send completion email:', err));

  res.json({ success: true, data: { message: 'Project completed and report generated.' } });
}

export async function downloadReport(req: AuthRequest, res: Response): Promise<void> {
  const report = await prisma.eodReport.findFirst({
    where: {
      id: req.params.id as string,
      adminId: getAdminId(req),
    },
    include: { fault: { select: { projectRef: true } } },
  });

  if (!report || !report.pdfR2Key) {
    res.status(404).json({ success: false, error: 'Report not found' });
    return;
  }

  try {
    const buffer = await getFile(report.pdfR2Key);
    const filename = `Infrava-Report-${report.fault?.projectRef || 'report'}.pdf`;
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
    where: { adminId: getAdminId(req), role: UserRole.OPERATIVE, isActive: true },
    select: {
      id: true, name: true, email: true, lastLoginAt: true, createdAt: true,
      operativeAssignedFaults: {
        where: { status: { not: FaultStatus.COMPLETED } },
        select: { id: true, projectRef: true, title: true, status: true },
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
      adminId: getAdminId(req),
    },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  res.status(201).json({ success: true, data: operative });
}

export async function updateOperative(req: AuthRequest, res: Response): Promise<void> {
  const id = req.params.id as string;
  const data = req.body as UpdateOperativeInput;

  const operative = await prisma.user.findFirst({
    where: { id, adminId: getAdminId(req), role: UserRole.OPERATIVE },
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
    where: { id, adminId: getAdminId(req), role: UserRole.OPERATIVE },
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
  const adminId = getAdminId(req);
  const clientId = req.query.clientId as string | undefined;
  const clientFilter = clientId ? { clientId: clientId === 'none' ? null : clientId } : getClientScopeFilter(req);

  const baseWhere = { adminId, ...clientFilter } as any;
  const [total, byStatus, byPriority, overdue, completedCount, byWorkType] = await Promise.all([
    prisma.fault.count({ where: baseWhere }),
    prisma.fault.groupBy({ by: ['status'], where: baseWhere, _count: true }),
    prisma.fault.groupBy({ by: ['priority'], where: baseWhere, _count: true }),
    prisma.fault.count({
      where: {
        ...baseWhere,
        status: { notIn: [FaultStatus.COMPLETED] },
        plannedCompletion: { lt: new Date() },
      },
    }),
    prisma.fault.count({ where: { ...baseWhere, status: FaultStatus.COMPLETED } }),
    prisma.fault.groupBy({ by: ['workType'], where: baseWhere, _count: true }),
  ]);

  // Completed faults for avg completion time
  const completedFaults = await prisma.fault.findMany({
    where: { ...baseWhere, status: FaultStatus.COMPLETED, completedAt: { not: null } },
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
    where: { fault: { ...baseWhere }, isLocked: true },
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
  const clientId = req.query.clientId as string | undefined;
  const reports = await prisma.eodReport.findMany({
    where: {
      adminId: getAdminId(req),
      ...(clientId && { fault: { clientId } }),
    },
    include: {
      fault: { select: { projectRef: true, title: true, status: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ success: true, data: reports });
}

// ─── Audit Logs ─────────────────────────────────────────────────────

export async function listAuditLogs(req: AuthRequest, res: Response): Promise<void> {
  const clientId = req.query.clientId as string | undefined;
  const logs = await prisma.faultAuditLog.findMany({
    where: {
      fault: {
        adminId: getAdminId(req),
        ...(clientId && { clientId }),
      },
    },
    include: {
      fault: { select: { projectRef: true, title: true } },
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
      target: { adminId: getAdminId(req) },
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
    where: { id, target: { adminId: getAdminId(req) } },
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

// ─── Rate Cards ────────────────────────────────────────────────────

export async function createRateCard(req: AuthRequest, res: Response): Promise<void> {
  const input = req.body as CreateRateCardInput;
  const adminId = getAdminId(req);

  const rateCard = await prisma.rateCard.create({
    data: { adminId, ...input },
  });

  res.status(201).json({ success: true, data: rateCard });
}

export async function listRateCards(req: AuthRequest, res: Response): Promise<void> {
  const clientId = req.query.clientId as string | undefined;
  const category = req.query.category as string | undefined;

  const rateCards = await prisma.rateCard.findMany({
    where: {
      adminId: getAdminId(req),
      ...(clientId && { clientId }),
      ...(category && { category }),
    },
    orderBy: [{ category: 'asc' }, { resourceName: 'asc' }],
  });

  res.json({ success: true, data: rateCards });
}

export async function getRateCard(req: AuthRequest, res: Response): Promise<void> {
  const rateCard = await prisma.rateCard.findFirst({
    where: { id: req.params.id as string, adminId: getAdminId(req) },
  });

  if (!rateCard) {
    res.status(404).json({ success: false, error: 'Rate card not found' });
    return;
  }

  res.json({ success: true, data: rateCard });
}

export async function updateRateCard(req: AuthRequest, res: Response): Promise<void> {
  const rateCard = await prisma.rateCard.findFirst({
    where: { id: req.params.id as string, adminId: getAdminId(req) },
  });

  if (!rateCard) {
    res.status(404).json({ success: false, error: 'Rate card not found' });
    return;
  }

  const input = req.body as UpdateRateCardInput;
  const updated = await prisma.rateCard.update({
    where: { id: rateCard.id },
    data: input,
  });

  res.json({ success: true, data: updated });
}

export async function deleteRateCard(req: AuthRequest, res: Response): Promise<void> {
  const rateCard = await prisma.rateCard.findFirst({
    where: { id: req.params.id as string, adminId: getAdminId(req) },
  });

  if (!rateCard) {
    res.status(404).json({ success: false, error: 'Rate card not found' });
    return;
  }

  await prisma.rateCard.delete({ where: { id: rateCard.id } });
  res.json({ success: true, data: { message: 'Rate card deleted' } });
}

// ─── Quotations ────────────────────────────────────────────────────

function computeAmount(quantity: number, rate: number, uplift: number): number {
  return Math.round(quantity * rate * (1 + (uplift || 0) / 100) * 100) / 100;
}

function computeQuotationTotals(items: { category: string; amount: number }[], vatPercent?: number | null) {
  const categorySubtotals: Record<string, number> = {};
  for (const item of items) {
    categorySubtotals[item.category] = (categorySubtotals[item.category] || 0) + item.amount;
  }
  const totalExclVat = items.reduce((sum, item) => sum + item.amount, 0);
  const vat = vatPercent ? Math.round(totalExclVat * vatPercent / 100 * 100) / 100 : 0;
  return {
    categorySubtotals,
    totalExclVat: Math.round(totalExclVat * 100) / 100,
    vatAmount: vat,
    totalInclVat: Math.round((totalExclVat + vat) * 100) / 100,
  };
}

export async function createQuotation(req: AuthRequest, res: Response): Promise<void> {
  const { clientId, title, workDescription, enabledCategories, vatPercent, note, status, sections, items } = req.body as CreateQuotationInput;

  if (!clientId) {
    res.status(400).json({ success: false, error: 'Client is required' });
    return;
  }

  const quotationRef = await generateQuotationRef(clientId);

  const quotation = await prisma.quotation.create({
    data: {
      adminId: getAdminId(req),
      clientId,
      quotationRef,
      title,
      workDescription,
      methodology: sections,
      enabledCategories,
      vatPercent: vatPercent ?? null,
      note: note || null,
      status: status || 'DRAFT',
      items: {
        create: items.map((item, i) => ({
          itemNo: i + 1,
          category: item.category,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          rate: item.rate,
          uplift: item.uplift || 0,
          amount: computeAmount(item.quantity, item.rate, item.uplift || 0),
          rateCardId: item.rateCardId || null,
        })),
      },
    },
    include: { items: { orderBy: { itemNo: 'asc' } } },
  });

  const totals = computeQuotationTotals(quotation.items, quotation.vatPercent);
  res.status(201).json({ success: true, data: { ...quotation, ...totals } });
}

export async function listQuotations(req: AuthRequest, res: Response): Promise<void> {
  const clientId = req.query.clientId as string | undefined;
  const quotations = await prisma.quotation.findMany({
    where: { adminId: getAdminId(req), ...(clientId ? { clientId: clientId === 'none' ? null : clientId } : getClientScopeFilter(req)) } as any,
    include: {
      items: true,
      parent: { select: { id: true, quotationRef: true, revisionNumber: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const data = quotations.map((q) => {
    const totals = computeQuotationTotals(q.items, q.vatPercent);
    return { ...q, ...totals, grandTotal: totals.totalInclVat, itemCount: q.items.length };
  });

  res.json({ success: true, data });
}

export async function getQuotation(req: AuthRequest, res: Response): Promise<void> {
  const quotation = await prisma.quotation.findFirst({
    where: { id: req.params.id as string, adminId: getAdminId(req) },
    include: {
      items: { orderBy: { itemNo: 'asc' } },
      parent: { select: { id: true, quotationRef: true, revisionNumber: true, title: true } },
      revisions: { select: { id: true, quotationRef: true, revisionNumber: true, status: true, createdAt: true }, orderBy: { revisionNumber: 'asc' } },
    },
  });

  if (!quotation) {
    res.status(404).json({ success: false, error: 'Quotation not found' });
    return;
  }

  const totals = computeQuotationTotals(quotation.items, quotation.vatPercent);
  res.json({ success: true, data: { ...quotation, ...totals, grandTotal: totals.totalInclVat } });
}

export async function updateQuotation(req: AuthRequest, res: Response): Promise<void> {
  const quotation = await prisma.quotation.findFirst({
    where: { id: req.params.id as string, adminId: getAdminId(req) },
  });

  if (!quotation) {
    res.status(404).json({ success: false, error: 'Quotation not found' });
    return;
  }

  if (quotation.status === 'FINAL') {
    res.status(400).json({ success: false, error: 'Cannot edit a finalized quotation' });
    return;
  }

  const { title, workDescription, enabledCategories, vatPercent, note, status, sections, items } = req.body as UpdateQuotationInput;

  await prisma.$transaction(async (tx) => {
    await tx.quotation.update({
      where: { id: quotation.id },
      data: {
        ...(title !== undefined && { title }),
        ...(workDescription !== undefined && { workDescription }),
        ...(sections !== undefined && { methodology: sections }),
        ...(enabledCategories !== undefined && { enabledCategories }),
        ...(vatPercent !== undefined && { vatPercent: vatPercent ?? null }),
        ...(note !== undefined && { note: note || null }),
        ...(status !== undefined && { status }),
      },
    });

    if (items !== undefined) {
      await tx.quotationItem.deleteMany({ where: { quotationId: quotation.id } });
      await tx.quotationItem.createMany({
        data: items.map((item, i) => ({
          quotationId: quotation.id,
          itemNo: i + 1,
          category: item.category,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          rate: item.rate,
          uplift: item.uplift || 0,
          amount: computeAmount(item.quantity, item.rate, item.uplift || 0),
          rateCardId: item.rateCardId || null,
        })),
      });
    }
  });

  const updated = await prisma.quotation.findUnique({
    where: { id: quotation.id },
    include: { items: { orderBy: { itemNo: 'asc' } } },
  });

  if (updated) {
    const totals = computeQuotationTotals(updated.items, updated.vatPercent);
    res.json({ success: true, data: { ...updated, ...totals } });
  } else {
    res.json({ success: true, data: updated });
  }
}

export async function deleteQuotation(req: AuthRequest, res: Response): Promise<void> {
  const quotation = await prisma.quotation.findFirst({
    where: { id: req.params.id as string, adminId: getAdminId(req) },
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

export async function reviseQuotation(req: AuthRequest, res: Response): Promise<void> {
  const adminId = getAdminId(req);
  const quotation = await prisma.quotation.findFirst({
    where: { id: req.params.id as string, adminId },
    include: { items: { orderBy: { itemNo: 'asc' } } },
  });

  if (!quotation) {
    res.status(404).json({ success: false, error: 'Quotation not found' });
    return;
  }

  if (quotation.status !== 'FINAL') {
    res.status(400).json({ success: false, error: 'Only finalized quotations can be revised' });
    return;
  }

  // Derive the clean base ref (strip R suffix) for numbering
  const cleanBaseRef = quotation.quotationRef.replace(/R\d+$/, '');

  // Find the highest revision number among all quotations with the same base ref
  const allRevisions = await prisma.quotation.findMany({
    where: { adminId, quotationRef: { startsWith: cleanBaseRef } },
    select: { revisionNumber: true },
  });
  const maxRevNum = allRevisions.reduce((max, r) => Math.max(max, r.revisionNumber), 0);
  const newRevisionNumber = maxRevNum + 1;
  const newRef = `${cleanBaseRef}R${newRevisionNumber}`;

  const created = await prisma.quotation.create({
    data: {
      adminId,
      clientId: quotation.clientId,
      quotationRef: newRef,
      parentId: quotation.id,
      revisionNumber: newRevisionNumber,
      title: quotation.title,
      workDescription: quotation.workDescription,
      methodology: quotation.methodology ?? undefined,
      enabledCategories: quotation.enabledCategories as any,
      vatPercent: quotation.vatPercent,
      note: quotation.note,
      status: 'DRAFT',
      items: {
        create: quotation.items.map((item, i) => ({
          itemNo: i + 1,
          category: item.category,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          rate: item.rate,
          uplift: item.uplift,
          amount: item.amount,
          rateCardId: item.rateCardId,
        })),
      },
    },
  });

  const revision = await prisma.quotation.findUnique({
    where: { id: created.id },
    include: { items: { orderBy: { itemNo: 'asc' } } },
  });

  const totals = computeQuotationTotals(revision!.items, revision!.vatPercent);
  res.status(201).json({ success: true, data: { ...revision, ...totals } });
}

export async function downloadQuotationPdf(req: AuthRequest, res: Response): Promise<void> {
  const quotation = await prisma.quotation.findFirst({
    where: { id: req.params.id as string, adminId: getAdminId(req) },
    include: {
      admin: {
        select: {
          id: true, name: true, email: true,
          companyName: true, companyAddress: true, companyWebsite: true,
          companyPhone: true, companyEmail: true, companyAbn: true, logoUrl: true,
        },
      },
      client: {
        select: {
          name: true, address: true,
          opsContactName: true, opsContactEmail: true, opsContactPhone: true,
          comContactName: true, comContactEmail: true, comContactPhone: true,
        },
      },
      items: { orderBy: { itemNo: 'asc' } },
      parent: { select: { id: true, quotationRef: true, revisionNumber: true, title: true } },
    },
  });

  if (!quotation) {
    res.status(404).json({ success: false, error: 'Quotation not found' });
    return;
  }

  const buffer = await generateQuotationPdf(quotation);
  const filename = `Quotation-${quotation.quotationRef}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

// ─── Client CRUD ───────────────────────────────────────────────────

export async function presignClientLogo(req: AuthRequest, res: Response): Promise<void> {
  const { contentType, fileName } = req.body as AdminPresignPhotoInput;
  const uniqueId = `logo_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const cleanName = fileName ? fileName.replace(/[^a-zA-Z0-9.-]/g, '_') : 'logo';
  const r2Key = `client-logos/${getAdminId(req)}/${uniqueId}-${cleanName}`;
  const { url } = await getPresignedUploadUrl(r2Key, contentType);
  res.json({ success: true, data: { uploadUrl: url, r2Key } });
}

export async function createClient(req: AuthRequest, res: Response): Promise<void> {
  const input = req.body as CreateClientInput;
  const adminId = getAdminId(req);

  const existing = await prisma.client.findFirst({
    where: { adminId, name: input.name },
  });
  if (existing) {
    res.status(400).json({ success: false, error: 'Client with this name already exists' });
    return;
  }

  // Auto-generate a unique prefix from client name (e.g. "Network Rail" → "NR")
  const prefix = await resolveUniquePrefix(adminId, input.name);

  const client = await prisma.client.create({
    data: {
      adminId,
      name: input.name,
      address: input.address || undefined,
      logoR2Key: input.logoR2Key || undefined,
      clientRefPrefix: prefix,
      opsContactName: input.opsContactName || undefined,
      opsContactEmail: input.opsContactEmail || undefined,
      opsContactPhone: input.opsContactPhone || undefined,
      comContactName: input.comContactName || undefined,
      comContactEmail: input.comContactEmail || undefined,
      comContactPhone: input.comContactPhone || undefined,
    },
  });

  // Create sequence rows for this client
  await createProjectSequence(adminId, client.id, prefix);
  await createQuotationSequence(adminId, client.id, prefix);

  res.status(201).json({ success: true, data: client });
}

export async function listClients(req: AuthRequest, res: Response): Promise<void> {
  const adminId = getAdminId(req);
  const clients = await prisma.client.findMany({
    where: { adminId, isActive: true },
    include: {
      _count: { select: { faults: true, quotations: true } },
      formTemplate: { select: { id: true, name: true } },
    },
    orderBy: { name: 'asc' },
  });

  res.json({ success: true, data: clients });
}

export async function getClient(req: AuthRequest, res: Response): Promise<void> {
  const client = await prisma.client.findFirst({
    where: { id: req.params.clientId as string, adminId: getAdminId(req) },
    include: {
      _count: { select: { faults: true, quotations: true } },
      formTemplate: { select: { id: true, name: true } },
    },
  });

  if (!client) {
    res.status(404).json({ success: false, error: 'Client not found' });
    return;
  }

  res.json({ success: true, data: client });
}

export async function updateClient(req: AuthRequest, res: Response): Promise<void> {
  const client = await prisma.client.findFirst({
    where: { id: req.params.clientId as string, adminId: getAdminId(req) },
  });

  if (!client) {
    res.status(404).json({ success: false, error: 'Client not found' });
    return;
  }

  const input = req.body as UpdateClientInput;
  const updated = await prisma.client.update({
    where: { id: client.id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.address !== undefined && { address: input.address || null }),
      ...(input.logoR2Key !== undefined && { logoR2Key: input.logoR2Key || null }),
      ...(input.opsContactName !== undefined && { opsContactName: input.opsContactName || null }),
      ...(input.opsContactEmail !== undefined && { opsContactEmail: input.opsContactEmail || null }),
      ...(input.opsContactPhone !== undefined && { opsContactPhone: input.opsContactPhone || null }),
      ...(input.comContactName !== undefined && { comContactName: input.comContactName || null }),
      ...(input.comContactEmail !== undefined && { comContactEmail: input.comContactEmail || null }),
      ...(input.comContactPhone !== undefined && { comContactPhone: input.comContactPhone || null }),
    },
  });

  res.json({ success: true, data: updated });
}

export async function deleteClient(req: AuthRequest, res: Response): Promise<void> {
  const client = await prisma.client.findFirst({
    where: { id: req.params.clientId as string, adminId: getAdminId(req) },
  });

  if (!client) {
    res.status(404).json({ success: false, error: 'Client not found' });
    return;
  }

  await prisma.client.update({ where: { id: client.id }, data: { isActive: false } });
  res.json({ success: true, data: { message: 'Client deactivated' } });
}

export async function uploadContract(req: AuthRequest, res: Response): Promise<void> {
  const client = await prisma.client.findFirst({
    where: { id: req.params.clientId as string, adminId: getAdminId(req) },
  });

  if (!client) {
    res.status(404).json({ success: false, error: 'Client not found' });
    return;
  }

  const r2Key = `contracts/${client.id}/${Date.now()}.pdf`;
  const { url } = await getPresignedUploadUrl(r2Key, 'application/pdf');

  await prisma.client.update({
    where: { id: client.id },
    data: { contractPdfR2Key: r2Key },
  });

  res.json({ success: true, data: { uploadUrl: url, r2Key } });
}

export async function listClientFaults(req: AuthRequest, res: Response): Promise<void> {
  const clientId = req.params.clientId as string;
  const client = await prisma.client.findFirst({
    where: { id: clientId, adminId: getAdminId(req) },
  });
  if (!client) {
    res.status(404).json({ success: false, error: 'Client not found' });
    return;
  }

  const faults = await prisma.fault.findMany({
    where: { clientId, adminId: getAdminId(req) },
    include: {
      assignedOperative: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ success: true, data: faults });
}

export async function getClientAnalytics(req: AuthRequest, res: Response): Promise<void> {
  const clientId = req.params.clientId as string;
  const adminId = getAdminId(req);

  const client = await prisma.client.findFirst({ where: { id: clientId, adminId } });
  if (!client) {
    res.status(404).json({ success: false, error: 'Client not found' });
    return;
  }

  const [total, completed, overdue, byStatus] = await Promise.all([
    prisma.fault.count({ where: { adminId, clientId } }),
    prisma.fault.count({ where: { adminId, clientId, status: FaultStatus.COMPLETED } }),
    prisma.fault.count({
      where: { adminId, clientId, status: { notIn: [FaultStatus.COMPLETED] }, plannedCompletion: { lt: new Date() } },
    }),
    prisma.fault.groupBy({ by: ['status'], where: { adminId, clientId }, _count: true }),
  ]);

  res.json({
    success: true,
    data: {
      total,
      completed,
      overdue,
      inProgress: total - completed,
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
    },
  });
}

// ─── Template CRUD (Standalone) ────────────────────────────────────

export async function listTemplates(req: AuthRequest, res: Response): Promise<void> {
  const adminId = getAdminId(req);
  const templates = await prisma.formTemplate.findMany({
    where: { adminId, isActive: true },
    include: { _count: { select: { clients: true } } },
    orderBy: { name: 'asc' },
  });

  res.json({ success: true, data: templates });
}

export async function getTemplate(req: AuthRequest, res: Response): Promise<void> {
  const template = await prisma.formTemplate.findFirst({
    where: { id: req.params.id as string, adminId: getAdminId(req), isActive: true },
    include: { _count: { select: { clients: true } } },
  });

  if (!template) {
    res.status(404).json({ success: false, error: 'Template not found' });
    return;
  }

  res.json({ success: true, data: template });
}

export async function createTemplate(req: AuthRequest, res: Response): Promise<void> {
  const adminId = getAdminId(req);
  const input = req.body as CreateTemplateInput;

  const existing = await prisma.formTemplate.findFirst({
    where: { adminId, name: input.name, isActive: true },
  });
  if (existing) {
    res.status(400).json({ success: false, error: 'A template with this name already exists' });
    return;
  }

  const template = await prisma.formTemplate.create({
    data: {
      adminId,
      name: input.name,
      schema: input.schema as any,
    },
  });

  res.status(201).json({ success: true, data: template });
}

export async function updateTemplate(req: AuthRequest, res: Response): Promise<void> {
  const template = await prisma.formTemplate.findFirst({
    where: { id: req.params.id as string, adminId: getAdminId(req), isActive: true },
  });

  if (!template) {
    res.status(404).json({ success: false, error: 'Template not found' });
    return;
  }

  const input = req.body as UpdateTemplateInput;

  // If name is changing, check for duplicates
  if (input.name && input.name !== template.name) {
    const existing = await prisma.formTemplate.findFirst({
      where: { adminId: getAdminId(req), name: input.name, isActive: true, id: { not: template.id } },
    });
    if (existing) {
      res.status(400).json({ success: false, error: 'A template with this name already exists' });
      return;
    }
  }

  const updated = await prisma.formTemplate.update({
    where: { id: template.id },
    data: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.schema ? { schema: input.schema as any } : {}),
    },
  });

  res.json({ success: true, data: updated });
}

export async function deleteTemplate(req: AuthRequest, res: Response): Promise<void> {
  const template = await prisma.formTemplate.findFirst({
    where: { id: req.params.id as string, adminId: getAdminId(req), isActive: true },
  });

  if (!template) {
    res.status(404).json({ success: false, error: 'Template not found' });
    return;
  }

  // Unlink any clients using this template
  await prisma.client.updateMany({
    where: { formTemplateId: template.id },
    data: { formTemplateId: null },
  });

  await prisma.formTemplate.update({
    where: { id: template.id },
    data: { isActive: false },
  });

  res.json({ success: true });
}

// ─── Manager CRUD ──────────────────────────────────────────────────

export async function createManager(req: AuthRequest, res: Response): Promise<void> {
  // Only ADMIN can create managers (not other managers)
  if (req.user!.role !== UserRole.ADMIN) {
    res.status(403).json({ success: false, error: 'Only admins can create managers' });
    return;
  }

  const { name, email, password, permissions } = req.body as CreateManagerInput;

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (existing) {
    res.status(400).json({ success: false, error: 'Email already in use' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS);
  const manager = await prisma.user.create({
    data: {
      name,
      email: email.toLowerCase().trim(),
      passwordHash,
      role: UserRole.MANAGER,
      adminId: req.user!.id,
      isApproved: true,
      permissions: permissions ? (permissions as any) : undefined,
    },
    select: { id: true, name: true, email: true, role: true, permissions: true, createdAt: true },
  });

  res.status(201).json({ success: true, data: manager });
}

export async function listManagers(req: AuthRequest, res: Response): Promise<void> {
  if (req.user!.role !== UserRole.ADMIN) {
    res.status(403).json({ success: false, error: 'Only admins can list managers' });
    return;
  }

  const managers = await prisma.user.findMany({
    where: { adminId: req.user!.id, role: UserRole.MANAGER, isActive: true },
    select: { id: true, name: true, email: true, permissions: true, lastLoginAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ success: true, data: managers });
}

export async function updateManagerPermissions(req: AuthRequest, res: Response): Promise<void> {
  if (req.user!.role !== UserRole.ADMIN) {
    res.status(403).json({ success: false, error: 'Only admins can update manager permissions' });
    return;
  }

  const id = req.params.id as string;
  const { permissions } = req.body as UpdateManagerPermissionsInput;

  const manager = await prisma.user.findFirst({
    where: { id, adminId: req.user!.id, role: UserRole.MANAGER },
  });
  if (!manager) {
    res.status(404).json({ success: false, error: 'Manager not found' });
    return;
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { permissions: permissions as any },
    select: { id: true, name: true, email: true, permissions: true },
  });

  res.json({ success: true, data: updated });
}

export async function deleteManager(req: AuthRequest, res: Response): Promise<void> {
  if (req.user!.role !== UserRole.ADMIN) {
    res.status(403).json({ success: false, error: 'Only admins can delete managers' });
    return;
  }

  const id = req.params.id as string;
  const manager = await prisma.user.findFirst({
    where: { id, adminId: req.user!.id, role: UserRole.MANAGER },
  });
  if (!manager) {
    res.status(404).json({ success: false, error: 'Manager not found' });
    return;
  }

  await prisma.user.update({ where: { id }, data: { isActive: false } });
  res.json({ success: true, data: { message: 'Manager deactivated' } });
}
