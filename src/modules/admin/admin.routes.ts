import { Router } from 'express';
import multer from 'multer';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { requireRoles, requirePermission, resolveAdminId } from '../../shared/middleware/rbac.middleware';
import { validate } from '../../shared/middleware/validate.middleware';
import { UserRole } from '../../types';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      cb(null, true);
    } else {
      cb(new Error('Only .docx files are allowed'));
    }
  },
});
import {
  createFaultSchema, updateFaultSchema,
  assignOperativeSchema, reassignSchema, rejectSchema,
  createOperativeSchema, updateOperativeSchema,
  processDeletionSchema, adminPresignPhotoSchema,
  createQuotationSchema, updateQuotationSchema,
  createClientSchema, updateClientSchema,
  createManagerSchema, updateManagerPermissionsSchema,
  createTemplateSchema, updateTemplateSchema,
} from './admin.schemas';
import * as ctrl from './admin.controller';

const router = Router();

// All routes require ADMIN or MANAGER role
router.use(authMiddleware, requireRoles([UserRole.ADMIN, UserRole.MANAGER]), resolveAdminId());

// ─── Client CRUD ─────────────────────────────────────────────────
router.post('/clients/logo/presign', requirePermission('clients', 'create'), validate(adminPresignPhotoSchema), ctrl.presignClientLogo);
router.post('/clients', requirePermission('clients', 'create'), validate(createClientSchema), ctrl.createClient);
router.get('/clients', requirePermission('clients', 'view'), ctrl.listClients);
router.get('/clients/:clientId', requirePermission('clients', 'view'), ctrl.getClient);
router.patch('/clients/:clientId', requirePermission('clients', 'edit'), validate(updateClientSchema), ctrl.updateClient);
router.delete('/clients/:clientId', requirePermission('clients', 'delete'), ctrl.deleteClient);
router.post('/clients/:clientId/contract', requirePermission('clients', 'edit'), ctrl.uploadContract);
router.get('/clients/:clientId/faults', requirePermission('faults', 'view'), ctrl.listClientFaults);
router.get('/clients/:clientId/analytics', requirePermission('analytics', 'view'), ctrl.getClientAnalytics);

// ─── Templates (Standalone) ──────────────────────────────────────
router.get('/templates', requirePermission('formBuilder', 'view'), ctrl.listTemplates);
router.post('/templates', requirePermission('formBuilder', 'edit'), validate(createTemplateSchema), ctrl.createTemplate);
router.get('/templates/:id', requirePermission('formBuilder', 'view'), ctrl.getTemplate);
router.put('/templates/:id', requirePermission('formBuilder', 'edit'), validate(updateTemplateSchema), ctrl.updateTemplate);
router.delete('/templates/:id', requirePermission('formBuilder', 'edit'), ctrl.deleteTemplate);

// DOCX parse (before CRUD so /faults/parse-docx matches before /faults/:id)
router.post('/faults/parse-docx', upload.single('file'), ctrl.parseDocx);

// Fault CRUD
router.post('/faults/photos/presign', validate(adminPresignPhotoSchema), ctrl.adminPresignPhoto);
router.post('/faults', requirePermission('faults', 'create'), validate(createFaultSchema), ctrl.createFault);
router.get('/faults', requirePermission('faults', 'view'), ctrl.listFaults);
router.get('/faults/:id', requirePermission('faults', 'view'), ctrl.getFault);
router.patch('/faults/:id', requirePermission('faults', 'edit'), validate(updateFaultSchema), ctrl.updateFault);
router.delete('/faults/:id', requirePermission('faults', 'delete'), ctrl.deleteFault);

// Fault queue (assign/reassign/reject/submit)
router.get('/queue', requirePermission('queue', 'view'), ctrl.getQueue);
router.get('/queue/:id', requirePermission('queue', 'view'), ctrl.getQueueItem);
router.post('/queue/:id/assign-operative', requirePermission('queue', 'assign'), validate(assignOperativeSchema), ctrl.assignOperative);
router.post('/queue/:id/reassign', requirePermission('queue', 'assign'), validate(reassignSchema), ctrl.reassignOperative);
router.post('/queue/:id/reject', requirePermission('queue', 'reject'), validate(rejectSchema), ctrl.rejectFault);
router.post('/queue/:id/final-submit', requirePermission('queue', 'finalSubmit'), ctrl.finalSubmit);

// Operative management
router.get('/operatives', requirePermission('operatives', 'view'), ctrl.listOperatives);
router.post('/operatives', requirePermission('operatives', 'create'), validate(createOperativeSchema), ctrl.createOperative);
router.patch('/operatives/:id', requirePermission('operatives', 'edit'), validate(updateOperativeSchema), ctrl.updateOperative);
router.delete('/operatives/:id', requirePermission('operatives', 'delete'), ctrl.deleteOperative);

// Dashboard features
router.get('/analytics', requirePermission('analytics', 'view'), ctrl.getAnalytics);
router.get('/reports', requirePermission('reports', 'view'), ctrl.listReports);
router.get('/reports/:id/download', requirePermission('reports', 'download'), ctrl.downloadReport);
router.get('/audit-logs', requirePermission('auditLogs', 'view'), ctrl.listAuditLogs);
router.get('/deletion-requests', requirePermission('gdpr', 'view'), ctrl.listDeletionRequests);
router.patch('/deletion-requests/:id', requirePermission('gdpr', 'process'), validate(processDeletionSchema), ctrl.processDeletionRequest);

// Quotations (Addons)
router.post('/quotations', requirePermission('quotations', 'create'), validate(createQuotationSchema), ctrl.createQuotation);
router.get('/quotations', requirePermission('quotations', 'view'), ctrl.listQuotations);
router.get('/quotations/:id', requirePermission('quotations', 'view'), ctrl.getQuotation);
router.patch('/quotations/:id', requirePermission('quotations', 'edit'), validate(updateQuotationSchema), ctrl.updateQuotation);
router.delete('/quotations/:id', requirePermission('quotations', 'delete'), ctrl.deleteQuotation);

// ─── Manager CRUD (Admin only) ──────────────────────────────────
router.post('/managers', ctrl.createManager);
router.get('/managers', ctrl.listManagers);
router.patch('/managers/:id/permissions', validate(updateManagerPermissionsSchema), ctrl.updateManagerPermissions);
router.delete('/managers/:id', ctrl.deleteManager);

export default router;
