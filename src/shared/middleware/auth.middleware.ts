import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { AuthRequest, JwtAccessPayload } from '../../types';

/**
 * Extracts Bearer token, verifies JWT + expiry, hits DB to confirm is_active.
 * Sets req.user = { id, email, role, adminId }.
 */
export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'No token provided' });
      return;
    }

    const token = authHeader.split(' ')[1];
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtAccessPayload;

    // DB check: is_active = true (deactivated users locked out immediately)
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, adminId: true, isActive: true, isApproved: true },
    });

    if (!user || !user.isActive) {
      res.status(401).json({ success: false, error: 'Account deactivated or not found' });
      return;
    }

    if (user.role === 'ADMIN' && !user.isApproved) {
      res.status(403).json({ success: false, error: 'Account pending approval' });
      return;
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      adminId: user.adminId,
    };

    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ success: false, error: 'Token expired' });
      return;
    }
    if (err instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ success: false, error: 'Invalid token' });
      return;
    }
    next(err);
  }
}
