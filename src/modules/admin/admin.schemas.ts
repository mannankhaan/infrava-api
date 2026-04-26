import { z } from 'zod';

// ─── Clients ───────────────────────────────────────────────────────

export const createClientSchema = z.object({
  name: z.string().min(1, 'Client name is required'),
  address: z.string().optional(),
  logoR2Key: z.string().optional(),
  opsContactName: z.string().optional(),
  opsContactEmail: z.string().email().optional().or(z.literal('')),
  opsContactPhone: z.string().optional(),
  comContactName: z.string().optional(),
  comContactEmail: z.string().email().optional().or(z.literal('')),
  comContactPhone: z.string().optional(),
});

export const updateClientSchema = createClientSchema.partial();

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

// ─── Managers ──────────────────────────────────────────────────────

export const createManagerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  permissions: z.object({
    clients: z.array(z.string()),
    features: z.record(z.string(), z.record(z.string(), z.boolean())),
  }).optional(),
});

export const updateManagerPermissionsSchema = z.object({
  permissions: z.object({
    clients: z.array(z.string()),
    features: z.record(z.string(), z.record(z.string(), z.boolean())),
  }),
});

export type CreateManagerInput = z.infer<typeof createManagerSchema>;
export type UpdateManagerPermissionsInput = z.infer<typeof updateManagerPermissionsSchema>;

// ─── Form Templates ────────────────────────────────────────────────

const formFieldSchema = z.object({
  key: z.string().min(1),
  type: z.enum(['text', 'textarea', 'number', 'date', 'datetime', 'boolean', 'select', 'multiselect', 'email', 'phone', 'url']),
  label: z.string().min(1),
  required: z.boolean().optional(),
  source: z.enum(['core', 'custom']),
  options: z.array(z.string()).optional(),
  placeholder: z.string().optional(),
});

const formSectionSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  fields: z.array(formFieldSchema).min(1),
});

export const createTemplateSchema = z.object({
  name: z.string().min(1, 'Template name is required'),
  schema: z.object({
    sections: z.array(formSectionSchema).min(1),
  }),
});

export const updateTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  schema: z.object({
    sections: z.array(formSectionSchema).min(1),
  }).optional(),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

// ─── Faults ────────────────────────────────────────────────────────

export const createFaultSchema = z.object({
  clientId: z.string().uuid('Client is required'),
  clientRef: z.string().optional(),
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
  formTemplateId: z.string().uuid().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  photos: z.array(
    z.object({
      r2Key: z.string(),
      fileName: z.string().optional(),
      fileSizeBytes: z.number().optional(),
    })
  ).optional(),
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

export const adminPresignPhotoSchema = z.object({
  contentType: z.string().min(1, 'Content type required'),
  fileName: z.string().optional(),
});

export type CreateFaultInput = z.infer<typeof createFaultSchema>;
export type UpdateFaultInput = z.infer<typeof updateFaultSchema>;
export type AssignOperativeInput = z.infer<typeof assignOperativeSchema>;
export type ReassignInput = z.infer<typeof reassignSchema>;
export type RejectInput = z.infer<typeof rejectSchema>;
export type CreateOperativeInput = z.infer<typeof createOperativeSchema>;
export type UpdateOperativeInput = z.infer<typeof updateOperativeSchema>;
export type ProcessDeletionInput = z.infer<typeof processDeletionSchema>;
export type AdminPresignPhotoInput = z.infer<typeof adminPresignPhotoSchema>;

// ─── Rate Cards ─────────────────────────────────────────────────────

const rateCardCategory = z.enum(['Labour', 'Plant', 'Material']);

export const createRateCardSchema = z.object({
  clientId: z.string().uuid(),
  category: rateCardCategory,
  resourceName: z.string().min(1, 'Resource name is required'),
  dayRateHourly: z.number().min(0).default(0),
  nightRateHourly: z.number().min(0).default(0),
  weekendRateHourly: z.number().min(0).default(0),
  dayRateShift: z.number().min(0).default(0),
  nightRateShift: z.number().min(0).default(0),
  weekendRateShift: z.number().min(0).default(0),
});

export const updateRateCardSchema = z.object({
  resourceName: z.string().min(1).optional(),
  dayRateHourly: z.number().min(0).optional(),
  nightRateHourly: z.number().min(0).optional(),
  weekendRateHourly: z.number().min(0).optional(),
  dayRateShift: z.number().min(0).optional(),
  nightRateShift: z.number().min(0).optional(),
  weekendRateShift: z.number().min(0).optional(),
});

export type CreateRateCardInput = z.infer<typeof createRateCardSchema>;
export type UpdateRateCardInput = z.infer<typeof updateRateCardSchema>;

// ─── Quotations ─────────────────────────────────────────────────────

const quotationSectionSchema = z.object({
  title: z.string().min(1, 'Section title is required'),
  content: z.string().refine(
    (val) => val.trim().length >= 200,
    { message: 'Section content must be at least 200 characters' }
  ),
  sortOrder: z.number().int().min(0).default(0),
});

const quotationItemSchema = z.object({
  category: z.enum(['Labour', 'Plant', 'Material']),
  description: z.string().min(1, 'Description is required'),
  quantity: z.number().positive('Quantity must be positive'),
  unit: z.string().min(1, 'Unit is required'),
  rate: z.number().min(0, 'Rate must be non-negative'),
  uplift: z.number().min(0).default(0),
  rateCardId: z.string().uuid().optional(),
});

export const createQuotationSchema = z.object({
  clientId: z.string().uuid().optional(),
  title: z.string().min(1, 'Title is required'),
  workDescription: z.string().refine(
    (val) => val.trim().length >= 200,
    { message: 'Work description must be at least 200 characters' }
  ),
  enabledCategories: z.array(z.enum(['Labour', 'Plant', 'Material'])).min(1, 'Enable at least one category'),
  vatPercent: z.number().min(0).max(100).nullable().optional(),
  status: z.enum(['DRAFT', 'FINAL']).optional().default('DRAFT'),
  sections: z.array(quotationSectionSchema).min(1, 'At least one methodology section is required'),
  items: z.array(quotationItemSchema).min(1, 'At least one estimate item is required'),
});

export const updateQuotationSchema = createQuotationSchema.partial();

export type CreateQuotationInput = z.infer<typeof createQuotationSchema>;
export type UpdateQuotationInput = z.infer<typeof updateQuotationSchema>;
