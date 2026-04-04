import { Router } from 'express';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { requireRoles } from '../../shared/middleware/rbac.middleware';
import { validate } from '../../shared/middleware/validate.middleware';
import { UserRole } from '../../types';
import { updateFaultSchema, updateWorkDaySchema, registerPhotoSchema, presignPhotoSchema, punchEventSchema, deletionRequestSchema } from './operative.schemas';
import * as ctrl from './operative.controller';

const router = Router();

// All routes require OPERATIVE role
router.use(authMiddleware, requireRoles([UserRole.OPERATIVE]));

// Faults
router.get('/faults', ctrl.listFaults);
router.get('/faults/:id', ctrl.getFault);
router.patch('/faults/:id', validate(updateFaultSchema), ctrl.updateFault);
router.post('/faults/:id/submit', ctrl.submitFault);

// Work days & punch events
router.post('/faults/:id/work-days', ctrl.addWorkDay);
router.patch('/faults/:id/work-days/:dayId', validate(updateWorkDaySchema), ctrl.updateWorkDay);
router.post('/faults/:id/work-days/:dayId/punch', validate(punchEventSchema), ctrl.recordPunchEvent);

// Photos
router.post('/faults/:id/photos/presign', validate(presignPhotoSchema), ctrl.presignPhoto);
router.post('/faults/:id/photos', validate(registerPhotoSchema), ctrl.registerPhoto);
router.delete('/faults/:id/photos/:pid', ctrl.deletePhoto);

// Data deletion
router.post('/deletion-request', validate(deletionRequestSchema), ctrl.requestDeletion);

export default router;
