import { z } from 'zod';

export const approveAdminSchema = z.object({
  approved: z.boolean(),
  rejectionReason: z.string().optional(),
});

export type ApproveAdminInput = z.infer<typeof approveAdminSchema>;
