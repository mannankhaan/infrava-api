import { UserRole, FaultStatus } from '@prisma/client';
import { Request } from 'express';

export { UserRole, FaultStatus };

export interface JwtAccessPayload {
  sub: string;
  email: string;
  role: UserRole;
  adminId: string | null;
}

export interface JwtRefreshPayload {
  sub: string;
  tokenId: string;
}

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  adminId: string | null;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: Record<string, unknown>;
}
