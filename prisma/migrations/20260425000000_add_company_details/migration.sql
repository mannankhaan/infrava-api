-- Add company detail fields to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "company_address" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "company_website" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "company_phone" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "company_email" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "company_abn" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "logo_url" TEXT;
