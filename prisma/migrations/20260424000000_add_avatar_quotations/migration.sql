-- Add avatar_url to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_url" TEXT;

-- Add QuotationStatus enum
DO $$ BEGIN
  CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'FINAL');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create quotations table
CREATE TABLE IF NOT EXISTS "quotations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "admin_id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "work_description" TEXT NOT NULL,
  "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- Create quotation_items table
CREATE TABLE IF NOT EXISTS "quotation_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "quotation_id" UUID NOT NULL,
  "item_no" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "unit" TEXT NOT NULL,
  "rate" DOUBLE PRECISION NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  CONSTRAINT "quotation_items_pkey" PRIMARY KEY ("id")
);

-- Add foreign keys
DO $$ BEGIN
  ALTER TABLE "quotations" ADD CONSTRAINT "quotations_admin_id_fkey"
    FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_quotation_id_fkey"
    FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
