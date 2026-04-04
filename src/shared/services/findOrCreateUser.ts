import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { UserRole } from '../../types';

interface FindOrCreateResult {
  user: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
  };
  isNew: boolean;
  tempPassword?: string;
}

/**
 * Find an existing operative by email or create a new one.
 * Used when admins assign faults to operatives.
 */
export async function findOrCreateUser(
  email: string,
  expectedRole: UserRole,
  adminId: string,
  assignerName: string
): Promise<FindOrCreateResult> {
  const normalizedEmail = email.toLowerCase().trim();

  const existing = await prisma.user.findFirst({
    where: { email: normalizedEmail, isActive: true },
    select: { id: true, name: true, email: true, role: true, adminId: true },
  });

  if (existing) {
    if (existing.role !== expectedRole) {
      throw new ApiError(400, `This email belongs to a ${existing.role} account, not ${expectedRole}`);
    }

    if (expectedRole === UserRole.OPERATIVE && existing.adminId !== adminId) {
      throw new ApiError(400, 'This Operative belongs to a different Admin');
    }

    return { user: existing, isNew: false };
  }

  // Create new operative
  const tempPassword = crypto.randomBytes(16).toString('hex');
  const passwordHash = await bcrypt.hash(tempPassword, env.BCRYPT_SALT_ROUNDS);

  const newUser = await prisma.user.create({
    data: {
      name: normalizedEmail.split('@')[0],
      email: normalizedEmail,
      passwordHash,
      role: expectedRole,
      adminId,
    },
    select: { id: true, name: true, email: true, role: true },
  });

  return { user: newUser, isNew: true, tempPassword };
}

export class ApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}
