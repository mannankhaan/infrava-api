import { Response, NextFunction } from 'express';
import { prisma } from '../../config/prisma';
import { AuthRequest, UserRole, ManagerPermissions } from '../../types';

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
 * Checks that a MANAGER has the required feature+action permission.
 * ADMINs always pass. Managers check permissions JSONB.
 */
export function requirePermission(feature: string, action: string) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }

    // Admin and super admin bypass permission checks
    if (req.user.role === UserRole.ADMIN || req.user.role === UserRole.SUPER_ADMIN) {
      return next();
    }

    // Manager: check permissions
    if (req.user.role === UserRole.MANAGER) {
      const perms = req.user.permissions as ManagerPermissions | null;
      if (!perms) {
        // No permissions set = full access (default)
        return next();
      }
      const featurePerms = perms.features?.[feature];
      if (!featurePerms || featurePerms[action] === false) {
        res.status(403).json({ success: false, error: `No permission: ${feature}.${action}` });
        return;
      }
      return next();
    }

    res.status(403).json({ success: false, error: 'Insufficient permissions' });
  };
}

/**
 * For managers: resolves the effective adminId.
 * Managers act on behalf of their admin (adminId from their user record).
 * Sets req.effectiveAdminId for use in controllers.
 */
export function resolveAdminId() {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }

    if (req.user.role === UserRole.ADMIN) {
      (req as any).effectiveAdminId = req.user.id;
    } else if (req.user.role === UserRole.MANAGER) {
      (req as any).effectiveAdminId = req.user.adminId;
    }

    next();
  };
}

/**
 * For managers with client-scoped permissions: checks that the entity's clientId
 * is within the manager's allowed clients list.
 */
export function requireClientAccess() {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }

    // Admin bypass
    if (req.user.role === UserRole.ADMIN) {
      return next();
    }

    // Manager: check client scope
    if (req.user.role === UserRole.MANAGER) {
      const perms = req.user.permissions as ManagerPermissions | null;
      if (!perms || (perms.clients.length === 1 && perms.clients[0] === '*')) {
        return next(); // full access
      }

      // Check the entity's clientId from request body or from DB
      const clientId = req.body?.clientId || req.query?.clientId;
      if (clientId && !perms.clients.includes(clientId as string)) {
        res.status(403).json({ success: false, error: 'No access to this client' });
        return;
      }

      // If accessing a fault by ID, check its clientId
      const faultId = (req.params.id || req.params.faultId) as string | undefined;
      if (faultId) {
        const fault = await prisma.fault.findUnique({
          where: { id: faultId },
          select: { clientId: true },
        });
        if (fault?.clientId && !perms.clients.includes(fault.clientId)) {
          res.status(403).json({ success: false, error: 'No access to this client' });
          return;
        }
      }
    }

    next();
  };
}

/**
 * Admin routes: ensures the fault belongs to this admin via fault.adminId.
 */
export function requireAdminScope() {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user || (req.user.role !== UserRole.ADMIN && req.user.role !== UserRole.MANAGER)) {
      res.status(403).json({ success: false, error: 'Admin access required' });
      return;
    }

    const faultId = (req.params.id || req.params.faultId) as string | undefined;
    if (faultId) {
      const effectiveAdminId = req.user.role === UserRole.MANAGER ? req.user.adminId : req.user.id;
      const fault = await prisma.fault.findUnique({
        where: { id: faultId },
        select: { adminId: true },
      });
      if (!fault) {
        res.status(404).json({ success: false, error: 'Fault not found' });
        return;
      }
      if (fault.adminId !== effectiveAdminId) {
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

    // Admin and Manager can access anything within their scope
    if (req.user.role === UserRole.ADMIN || req.user.role === UserRole.MANAGER) {
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
