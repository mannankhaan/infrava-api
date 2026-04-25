import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const signupSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  companyName: z.string().min(1, 'Company name is required'),
  companyAddress: z.string().min(1, 'Company address is required'),
  companyWebsite: z.string().optional().default(''),
  companyPhone: z.string().min(1, 'Company phone is required'),
  companyEmail: z.string().email('Invalid company email'),
  companyAbn: z.string().optional().default(''),
  logoUrl: z.string().url('Invalid logo URL').optional().or(z.literal('')),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
