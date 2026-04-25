import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { AuthRequest } from '../../types';
import { issueTokens, verifyRefreshToken, revokeRefreshToken, revokeAllUserTokens, signAccessToken } from '../../shared/services/token.service';
import { sendPasswordResetEmail, sendEmailVerification, sendNewSignupNotification } from '../../shared/services/email.service';
import { uploadFile, getFileUrl } from '../../shared/services/storage.service';
import { LoginInput, ForgotPasswordInput, ResetPasswordInput, SignupInput, VerifyEmailInput } from './auth.schemas';
import path from 'path';

export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { email, password } = req.body as LoginInput;

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: {
        id: true, email: true, name: true, role: true, avatarUrl: true,
        passwordHash: true, isActive: true, adminId: true, emailVerified: true, isApproved: true,
        companyName: true, companyAddress: true, companyWebsite: true,
        companyPhone: true, companyEmail: true, companyAbn: true, logoUrl: true,
      },
    });

    if (!user || !user.isActive) {
      res.status(401).json({ success: false, error: 'Invalid email or password' });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ success: false, error: 'Invalid email or password' });
      return;
    }

    // Admins must verify email before logging in (operatives skip this)
    if (user.role === 'ADMIN' && !user.emailVerified) {
      res.status(403).json({ success: false, error: 'Please verify your email before logging in' });
      return;
    }

    // Admins must be approved by super admin before logging in
    if (user.role === 'ADMIN' && !user.isApproved) {
      res.status(403).json({ success: false, error: 'Your account is pending approval. You will receive an email once approved.' });
      return;
    }

    // Update last login
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const { accessToken, refreshToken } = await issueTokens(
      user,
      req.ip || req.socket.remoteAddress,
      req.headers['user-agent']
    );

    // Set refresh token as HttpOnly cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/api/v1/auth',
    });

    res.json({
      success: true,
      data: {
        accessToken,
        user: {
          id: user.id, email: user.email, name: user.name, role: user.role, avatarUrl: user.avatarUrl,
          companyName: user.companyName, companyAddress: user.companyAddress, companyWebsite: user.companyWebsite,
          companyPhone: user.companyPhone, companyEmail: user.companyEmail, companyAbn: user.companyAbn, logoUrl: user.logoUrl,
        },
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

export async function refresh(req: Request, res: Response): Promise<void> {
  try {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!token) {
      res.status(401).json({ success: false, error: 'No refresh token' });
      return;
    }

    const { userId } = await verifyRefreshToken(token);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, adminId: true, isActive: true, isApproved: true },
    });

    if (!user || !user.isActive) {
      res.status(401).json({ success: false, error: 'Account deactivated' });
      return;
    }

    if (user.role === 'ADMIN' && !user.isApproved) {
      res.status(401).json({ success: false, error: 'Account pending approval' });
      return;
    }

    const accessToken = signAccessToken(user);
    res.json({ success: true, data: { accessToken } });
  } catch (err) {
    res.status(401).json({ success: false, error: 'Invalid refresh token' });
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  try {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    if (token) {
      const { tokenId } = await verifyRefreshToken(token);
      await revokeRefreshToken(tokenId);
    }

    res.clearCookie('refreshToken', { path: '/api/v1/auth' });
    res.json({ success: true, data: { message: 'Logged out' } });
  } catch {
    // Even if token is invalid, clear the cookie
    res.clearCookie('refreshToken', { path: '/api/v1/auth' });
    res.json({ success: true, data: { message: 'Logged out' } });
  }
}

export async function logoutAll(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }

    await revokeAllUserTokens(req.user.id);
    res.clearCookie('refreshToken', { path: '/api/v1/auth' });
    res.json({ success: true, data: { message: 'All sessions revoked' } });
  } catch (err) {
    console.error('Logout all error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  try {
    const { email } = req.body as ForgotPasswordInput;

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: { id: true, name: true, email: true, isActive: true },
    });

    // Always return success to prevent email enumeration
    if (!user || !user.isActive) {
      res.json({ success: true, data: { message: 'If the email exists, a reset link has been sent' } });
      return;
    }

    // Generate raw token, store SHA-256 hash
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      },
    });

    const resetLink = `${env.APP_URL}/reset-password?token=${rawToken}`;
    await sendPasswordResetEmail({ to: user.email, name: user.name, resetLink });

    res.json({ success: true, data: { message: 'If the email exists, a reset link has been sent' } });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  try {
    const { token, password } = req.body as ResetPasswordInput;

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const record = await prisma.passwordResetToken.findFirst({
      where: {
        tokenHash,
        expiresAt: { gt: new Date() },
        usedAt: null,
      },
    });

    if (!record) {
      res.status(400).json({ success: false, error: 'Invalid or expired reset token' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    res.json({ success: true, data: { message: 'Password reset successful' } });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

export async function signup(req: Request, res: Response): Promise<void> {
  try {
    const { name, email, password, companyName, companyAddress, companyWebsite, companyPhone, companyEmail, companyAbn, logoUrl: logoUrlInput } = req.body as SignupInput;
    const normalizedEmail = email.toLowerCase().trim();

    // Logo: either file upload or URL — at least one required
    const logoFile = req.file;
    if (!logoFile && !logoUrlInput) {
      res.status(400).json({ success: false, error: 'Company logo is required (upload a file or provide a URL)' });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      res.status(400).json({ success: false, error: 'Email already in use' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS);

    // Determine logo URL
    let logoUrl: string | null = logoUrlInput || null;

    const user = await prisma.user.create({
      data: {
        name,
        email: normalizedEmail,
        passwordHash,
        role: 'ADMIN',
        companyName,
        companyAddress,
        companyWebsite: companyWebsite || null,
        companyPhone,
        companyEmail,
        companyAbn: companyAbn || null,
        logoUrl,
        emailVerified: false,
      },
      select: { id: true, email: true, name: true },
    });

    // If file uploaded, upload to R2 and update logoUrl
    if (logoFile) {
      const ext = path.extname(logoFile.originalname).toLowerCase() || '.png';
      const logoKey = `logos/${user.id}${ext}`;
      await uploadFile(logoKey, logoFile.buffer);
      logoUrl = getFileUrl(logoKey);

      await prisma.user.update({
        where: { id: user.id },
        data: { logoUrl },
      });
    }

    // Generate verification token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      },
    });

    const verifyLink = `${env.APP_URL}/verify-email?token=${rawToken}`;
    await sendEmailVerification({ to: user.email, name: user.name, verifyLink });

    res.status(201).json({
      success: true,
      data: { message: 'Account created. Please check your email to verify your account.' },
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

export async function verifyEmail(req: Request, res: Response): Promise<void> {
  try {
    const { token } = req.body as VerifyEmailInput;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const record = await prisma.emailVerificationToken.findFirst({
      where: {
        tokenHash,
        expiresAt: { gt: new Date() },
        usedAt: null,
      },
    });

    if (!record) {
      res.status(400).json({ success: false, error: 'Invalid or expired verification token' });
      return;
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data: { emailVerified: true },
      }),
      prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    // Notify super admins about the new pending signup
    const verifiedUser = await prisma.user.findUnique({ where: { id: record.userId }, select: { name: true, email: true, companyName: true, role: true } });
    if (verifiedUser && verifiedUser.role === 'ADMIN' && env.SUPER_ADMIN_NOTIFICATION_EMAIL) {
      sendNewSignupNotification({
        to: env.SUPER_ADMIN_NOTIFICATION_EMAIL,
        adminName: verifiedUser.name,
        adminEmail: verifiedUser.email,
        companyName: verifiedUser.companyName || 'Not provided',
      }).catch(() => {}); // fire-and-forget
    }

    res.json({ success: true, data: { message: 'Email verified. Your account is pending approval by the Infrava team. You will receive an email once approved.' } });
  } catch (err) {
    console.error('Verify email error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

export async function uploadAvatar(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ success: false, error: 'No file uploaded' });
      return;
    }

    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const key = `avatars/${req.user.id}${ext}`;

    await uploadFile(key, file.buffer);
    const avatarUrl = getFileUrl(key);

    await prisma.user.update({
      where: { id: req.user.id },
      data: { avatarUrl },
    });

    res.json({ success: true, data: { avatarUrl } });
  } catch (err) {
    console.error('Upload avatar error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
