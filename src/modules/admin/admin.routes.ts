import { Router } from 'express';
import multer from 'multer';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { requireRoles } from '../../shared/middleware/rbac.middleware';
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
  processDeletionSchema,
} from './admin.schemas';
import * as ctrl from './admin.controller';

const router = Router();

// All routes require ADMIN role
router.use(authMiddleware, requireRoles([UserRole.ADMIN]));

// DOCX parse (before CRUD so /faults/parse-docx matches before /faults/:id)
router.post('/faults/parse-docx', upload.single('file'), ctrl.parseDocx);

// Fault CRUD
router.post('/faults', validate(createFaultSchema), ctrl.createFault);
router.get('/faults', ctrl.listFaults);
router.get('/faults/:id', ctrl.getFault);
router.patch('/faults/:id', validate(updateFaultSchema), ctrl.updateFault);
router.delete('/faults/:id', ctrl.deleteFault);

// Fault queue (assign/reassign/reject/submit)
router.get('/queue', ctrl.getQueue);
router.get('/queue/:id', ctrl.getQueueItem);
router.post('/queue/:id/assign-operative', validate(assignOperativeSchema), ctrl.assignOperative);
router.post('/queue/:id/reassign', validate(reassignSchema), ctrl.reassignOperative);
router.post('/queue/:id/reject', validate(rejectSchema), ctrl.rejectFault);
router.post('/queue/:id/final-submit', ctrl.finalSubmit);

// Operative management
router.get('/operatives', ctrl.listOperatives);
router.post('/operatives', validate(createOperativeSchema), ctrl.createOperative);
router.patch('/operatives/:id', validate(updateOperativeSchema), ctrl.updateOperative);
router.delete('/operatives/:id', ctrl.deleteOperative);

// Dashboard features
router.get('/analytics', ctrl.getAnalytics);
router.get('/reports', ctrl.listReports);
router.get('/reports/:id/download', ctrl.downloadReport);
router.get('/audit-logs', ctrl.listAuditLogs);
router.get('/deletion-requests', ctrl.listDeletionRequests);
router.patch('/deletion-requests/:id', validate(processDeletionSchema), ctrl.processDeletionRequest);

export default router;
