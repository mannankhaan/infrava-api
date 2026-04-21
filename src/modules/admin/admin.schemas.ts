import { z } from 'zod';

export const createFaultSchema = z.object({
  clientRef: z.string().min(1, 'Client Reference is required'),
  companyRef: z.string().optional(),
  title: z.string().min(1, 'Title is required'),
  workType: z.string().optional(),
  description: z.string().optional(),
  locationText: z.string().optional(),
  locationLat: z.number().optional(),
  locationLng: z.number().optional(),
  timeAllocated: z.string().datetime().optional(),
  plannedArrival: z.string().datetime().optional(),
  plannedCompletion: z.string().datetime().optional(),
  priority: z.string().optional(),
  onsiteContactName: z.string().optional(),
  onsiteContactPhone: z.string().optional(),
  onsiteContactEmail: z.string().optional(),
  visitTaskBriefing: z.boolean().optional(),
  visitLsr: z.boolean().optional(),
  visitLinkBlock: z.boolean().optional(),
  visitSafeWorkPack: z.boolean().optional(),
  visitPossession: z.boolean().optional(),
  visitTempWorks: z.boolean().optional(),
  visitIsolation: z.boolean().optional(),
  visitTrackAccess: z.boolean().optional(),
  visitTempWorksRequired: z.boolean().optional(),
  visitWorkingAtHeight: z.boolean().optional(),
  contractorCompany: z.string().optional(),
  contractorName: z.string().optional(),
  contractorEmail: z.string().optional(),
  contractorMobile: z.string().optional(),
});

export const updateFaultSchema = createFaultSchema.partial();

export const assignOperativeSchema = z.object({
  email: z.string().email('Valid email required'),
  note: z.string().optional(),
});

export const reassignSchema = z.object({
  email: z.string().email('Valid email required'),
  note: z.string().optional(),
});

export const rejectSchema = z.object({
  rejectionNote: z.string().min(1, 'Rejection note is required'),
});

export const createOperativeSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const updateOperativeSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
});

export const processDeletionSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().optional(),
});

export type CreateFaultInput = z.infer<typeof createFaultSchema>;
export type UpdateFaultInput = z.infer<typeof updateFaultSchema>;
export type AssignOperativeInput = z.infer<typeof assignOperativeSchema>;
export type ReassignInput = z.infer<typeof reassignSchema>;
export type RejectInput = z.infer<typeof rejectSchema>;
export type CreateOperativeInput = z.infer<typeof createOperativeSchema>;
export type UpdateOperativeInput = z.infer<typeof updateOperativeSchema>;
export type ProcessDeletionInput = z.infer<typeof processDeletionSchema>;

// ─── Quotations ─────────────────────────────────────────────────────

const estimateItemSchema = z.object({
  type: z.enum(['Labour', 'Plant', 'Material', 'Others']),
  description: z.string().min(1, 'Description is required'),
  quantity: z.number().positive('Quantity must be positive'),
  unit: z.string().min(1, 'Unit is required'),
  rate: z.number().min(0, 'Rate must be non-negative'),
});

export const createQuotationSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  workDescription: z.string().refine(
    (val) => val.trim().split(/\s+/).filter(Boolean).length >= 250,
    { message: 'Work description must be at least 250 words' }
  ),
  status: z.enum(['DRAFT', 'FINAL']).optional().default('DRAFT'),
  items: z.array(estimateItemSchema).min(1, 'At least one estimate item is required'),
});

export const updateQuotationSchema = createQuotationSchema.partial();

export type CreateQuotationInput = z.infer<typeof createQuotationSchema>;
export type UpdateQuotationInput = z.infer<typeof updateQuotationSchema>;
