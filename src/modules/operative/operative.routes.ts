import { Router } from 'express';
import multer from 'multer';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { requireRoles } from '../../shared/middleware/rbac.middleware';
import { validate } from '../../shared/middleware/validate.middleware';
import { UserRole } from '../../types';
import { updateFaultSchema, updateWorkDaySchema, punchEventSchema, deletionRequestSchema } from './operative.schemas';
import * as ctrl from './operative.controller';

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

const router = Router();

// All routes require OPERATIVE role
router.use(authMiddleware, requireRoles([UserRole.OPERATIVE]));

// Clients (distinct clients from assigned faults)
router.get('/clients', ctrl.listClients);

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
router.post('/faults/:id/photos', photoUpload.single('photo'), ctrl.uploadPhoto);
router.delete('/faults/:id/photos/:pid', ctrl.deletePhoto);

// Data deletion
router.post('/deletion-request', validate(deletionRequestSchema), ctrl.requestDeletion);

export default router;
