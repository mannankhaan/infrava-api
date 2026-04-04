import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { JwtAccessPayload, JwtRefreshPayload } from '../../types';
import { User } from '@prisma/client';

export function signAccessToken(user: Pick<User, 'id' | 'email' | 'role' | 'adminId'>): string {
  const payload: JwtAccessPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    adminId: user.adminId,
  };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRES_IN as any });
}

export async function issueTokens(
  user: Pick<User, 'id' | 'email' | 'role' | 'adminId'>,
  ipAddress?: string,
  userAgent?: string
) {
  const accessToken = signAccessToken(user);

  // Create refresh token record in DB
  const tokenId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const refreshPayload: JwtRefreshPayload = { sub: user.id, tokenId };
  const refreshToken = jwt.sign(refreshPayload, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_EXPIRES_IN as any });

  await prisma.refreshToken.create({
    data: {
      id: tokenId,
      userId: user.id,
      token: hashToken(refreshToken),
      expiresAt,
      ipAddress,
      userAgent,
    },
  });

  return { accessToken, refreshToken };
}

export async function verifyRefreshToken(token: string) {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as JwtRefreshPayload;

  const record = await prisma.refreshToken.findUnique({
    where: { id: payload.tokenId },
  });

  if (!record || record.isRevoked || record.expiresAt < new Date()) {
    throw new Error('Invalid or expired refresh token');
  }

  // Verify hash matches
  if (record.token !== hashToken(token)) {
    throw new Error('Token mismatch');
  }

  return { userId: payload.sub, tokenId: payload.tokenId };
}

export async function revokeRefreshToken(tokenId: string) {
  await prisma.refreshToken.update({
    where: { id: tokenId },
    data: { isRevoked: true },
  });
}

export async function revokeAllUserTokens(userId: string) {
  await prisma.refreshToken.updateMany({
    where: { userId, isRevoked: false },
    data: { isRevoked: true },
  });
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
