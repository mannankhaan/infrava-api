-- Add SUPER_ADMIN to UserRole enum
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';

-- Add is_approved column
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_approved" BOOLEAN NOT NULL DEFAULT false;

-- Grandfather all existing users as approved
UPDATE "users" SET "is_approved" = true;
