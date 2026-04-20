import { z } from 'zod';

const materialRowSchema = z.object({
  item: z.string(),
  qty: z.number(),
  unit: z.string().optional(),
});

const dimensionRowSchema = z.object({
  activity: z.string(),
  qty: z.number(),
  unit: z.string().optional(),
});

export const updateFaultSchema = z.object({
  supervisorNames: z.string().optional(),
  operativeName: z.string().optional(),
  materialsUsed: z.array(materialRowSchema).optional(),
  methodology: z.string().optional(),
  worksDescription: z.string().optional(),
  dimensions: z.array(dimensionRowSchema).optional(),
  furtherWork: z.boolean().optional(),
  furtherWorkNotes: z.string().optional(),
});

export const registerPhotoSchema = z.object({
  r2Key: z.string().min(1),
  photoStage: z.enum(['before', 'during', 'after', 'BEFORE', 'DURING', 'AFTER']).transform((val) => val.toLowerCase() as 'before' | 'during' | 'after'),
  fileName: z.string().optional(),
  fileSizeBytes: z.number().optional(),
  workDayId: z.string().uuid().optional().or(z.literal('')).or(z.null()),
});

export const presignPhotoSchema = z.object({
  photoStage: z.enum(['before', 'during', 'after', 'BEFORE', 'DURING', 'AFTER']).transform((val) => val.toLowerCase() as 'before' | 'during' | 'after'),
  fileName: z.string().min(1),
  contentType: z.string().min(1),
});

export const punchEventSchema = z.object({
  eventType: z.enum(['PUNCH_IN', 'REACHED', 'WORK_DONE', 'PUNCH_OUT']),
  lat: z.number(),
  lng: z.number(),
});

export const updateWorkDaySchema = z.object({
  supervisorNames: z.string().optional(),
  tradespersonNames: z.string().optional(),
  operativeName: z.string().optional(),
  materialsUsed: z.array(materialRowSchema).optional(),
  methodology: z.string().optional(),
  worksDescription: z.string().optional(),
  dimensions: z.array(dimensionRowSchema).optional(),
  furtherWork: z.boolean().optional(),
  furtherWorkNotes: z.string().optional(),
});

export const deletionRequestSchema = z.object({
  reason: z.string().max(500).optional(),
});

export type UpdateFaultInput = z.infer<typeof updateFaultSchema>;
export type UpdateWorkDayInput = z.infer<typeof updateWorkDaySchema>;
export type RegisterPhotoInput = z.infer<typeof registerPhotoSchema>;
export type PresignPhotoInput = z.infer<typeof presignPhotoSchema>;
export type PunchEventInput = z.infer<typeof punchEventSchema>;
export type DeletionRequestInput = z.infer<typeof deletionRequestSchema>;
