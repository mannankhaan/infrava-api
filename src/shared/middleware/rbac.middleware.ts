import { Response, NextFunction } from 'express';
import { prisma } from '../../config/prisma';
import { AuthRequest, UserRole } from '../../types';

/**
 * Checks req.user.role against allowed roles. Returns 403 if not matched.
 */
export function requireRoles(roles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

/**
 * Admin routes: ensures the fault belongs to this admin via fault.adminId.
 */
export function requireAdminScope() {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user || req.user.role !== UserRole.ADMIN) {
      res.status(403).json({ success: false, error: 'Admin access required' });
      return;
    }

    const faultId = (req.params.id || req.params.faultId) as string | undefined;
    if (faultId) {
      const fault = await prisma.fault.findUnique({
        where: { id: faultId },
        select: { adminId: true },
      });
      if (!fault) {
        res.status(404).json({ success: false, error: 'Fault not found' });
        return;
      }
      if (fault.adminId !== req.user.id) {
        res.status(403).json({ success: false, error: 'Fault not assigned to you' });
        return;
      }
    }

    next();
  };
}

/**
 * Operative routes: can only access own assigned faults. Admin bypasses.
 */
export function requireSelfOrAdmin() {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }

    // Admin can access anything within their scope
    if (req.user.role === UserRole.ADMIN) {
      return next();
    }

    // Operative: can only access own faults
    const faultId = (req.params.id || req.params.faultId) as string | undefined;
    if (faultId) {
      const fault = await prisma.fault.findUnique({
        where: { id: faultId },
        select: { assignedOperativeId: true },
      });
      if (!fault) {
        res.status(404).json({ success: false, error: 'Fault not found' });
        return;
      }
      if (fault.assignedOperativeId !== req.user.id) {
        res.status(403).json({ success: false, error: 'Fault not assigned to you' });
        return;
      }
    }

    next();
  };
}
