import { Router } from 'express';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { requireRoles } from '../../shared/middleware/rbac.middleware';
import { validate } from '../../shared/middleware/validate.middleware';
import { UserRole } from '../../types';
import { approveAdminSchema } from './superadmin.schemas';
import * as ctrl from './superadmin.controller';

const router = Router();

// All routes require SUPER_ADMIN role
router.use(authMiddleware, requireRoles([UserRole.SUPER_ADMIN]));

router.get('/pending-admins', ctrl.listPendingAdmins);
router.get('/admins', ctrl.listAdmins);
router.patch('/admins/:id/approve', validate(approveAdminSchema), ctrl.approveAdmin);
router.get('/stats', ctrl.getStats);

export default router;
