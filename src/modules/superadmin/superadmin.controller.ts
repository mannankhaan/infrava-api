import { Response } from 'express';
import { prisma } from '../../config/prisma';
import { AuthRequest } from '../../types';
import { sendAdminApprovedEmail, sendAdminRejectedEmail } from '../../shared/services/email.service';
import { ApproveAdminInput } from './superadmin.schemas';

/** List admins who have verified email but are not yet approved */
export async function listPendingAdmins(req: AuthRequest, res: Response): Promise<void> {
  try {
    const admins = await prisma.user.findMany({
      where: {
        role: 'ADMIN',
        emailVerified: true,
        isApproved: false,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        companyName: true,
        companyAddress: true,
        companyPhone: true,
        companyEmail: true,
        companyWebsite: true,
        companyAbn: true,
        logoUrl: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: admins });
  } catch (err) {
    console.error('List pending admins error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/** List all approved admins with counts */
export async function listAdmins(req: AuthRequest, res: Response): Promise<void> {
  try {
    const admins = await prisma.user.findMany({
      where: {
        role: 'ADMIN',
        isApproved: true,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        companyName: true,
        companyAddress: true,
        companyPhone: true,
        companyEmail: true,
        companyWebsite: true,
        logoUrl: true,
        createdAt: true,
        _count: {
          select: {
            adminFaults: true,
            operatives: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: admins });
  } catch (err) {
    console.error('List admins error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/** Approve or reject an admin */
export async function approveAdmin(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const { approved, rejectionReason } = req.body as ApproveAdminInput;

    const admin = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true, isApproved: true, isActive: true },
    });

    if (!admin || admin.role !== 'ADMIN') {
      res.status(404).json({ success: false, error: 'Admin not found' });
      return;
    }

    if (admin.isApproved) {
      res.status(400).json({ success: false, error: 'Admin is already approved' });
      return;
    }

    if (approved) {
      await prisma.user.update({
        where: { id },
        data: { isApproved: true },
      });

      sendAdminApprovedEmail({ to: admin.email, name: admin.name }).catch(() => {});

      res.json({ success: true, data: { message: 'Admin approved' } });
    } else {
      // Reject: deactivate the account
      await prisma.user.update({
        where: { id },
        data: { isActive: false },
      });

      sendAdminRejectedEmail({
        to: admin.email,
        name: admin.name,
        reason: rejectionReason,
      }).catch(() => {});

      res.json({ success: true, data: { message: 'Admin rejected' } });
    }
  } catch (err) {
    console.error('Approve admin error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/** Dashboard stats for super admin */
export async function getStats(req: AuthRequest, res: Response): Promise<void> {
  try {
    const [pendingCount, totalTenants, totalFaults, totalOperatives] = await Promise.all([
      prisma.user.count({
        where: { role: 'ADMIN', emailVerified: true, isApproved: false, isActive: true },
      }),
      prisma.user.count({
        where: { role: 'ADMIN', isApproved: true, isActive: true },
      }),
      prisma.fault.count(),
      prisma.user.count({
        where: { role: 'OPERATIVE', isActive: true },
      }),
    ]);

    res.json({
      success: true,
      data: { pendingCount, totalTenants, totalFaults, totalOperatives },
    });
  } catch (err) {
    console.error('Get stats error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
