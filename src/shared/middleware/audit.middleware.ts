import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../config/prisma';
import { AuthRequest } from '../../types';

/**
 * Auto-logs every POST/PATCH/DELETE request to audit_logs table.
 * Runs after the response is sent (non-blocking).
 */
export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();

  if (!['POST', 'PATCH', 'DELETE'].includes(method)) {
    return next();
  }

  // Hook into response finish to log after completion
  res.on('finish', () => {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.id || null;

    // Don't log auth endpoints (login attempts, etc.)
    if (req.path.startsWith('/api/v1/auth/')) return;

    prisma.auditLog.create({
      data: {
        userId,
        action: `${method} ${req.path}`,
        entityType: extractEntityType(req.path),
        entityId: extractEntityId(req.path),
        newValue: method !== 'DELETE' ? sanitizeBody(req.body) as any : undefined,
        ipAddress: req.ip || req.socket.remoteAddress || null,
        userAgent: req.headers['user-agent'] || null,
      },
    }).catch((err) => {
      console.error('Audit log failed:', err);
    });
  });

  next();
}

function extractEntityType(path: string): string {
  const parts = path.split('/').filter(Boolean);
  // /api/v1/<module>/<resource>/... → resource
  return parts[3] || parts[2] || 'unknown';
}

function extractEntityId(path: string): string | undefined {
  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const match = path.match(uuidRegex);
  return match ? match[0] : undefined;
}

function sanitizeBody(body: Record<string, unknown>): Record<string, unknown> {
  if (!body || typeof body !== 'object') return {};
  const sanitized = { ...body };
  // Never log passwords
  delete sanitized.password;
  delete sanitized.passwordHash;
  delete sanitized.password_hash;
  return sanitized;
}
