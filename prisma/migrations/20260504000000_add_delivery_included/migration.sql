-- Add delivery_included to rate_card_entries
ALTER TABLE "rate_card_entries" ADD COLUMN IF NOT EXISTS "delivery_included" BOOLEAN NOT NULL DEFAULT false;

-- Add delivery_included to quotation_items
ALTER TABLE "quotation_items" ADD COLUMN IF NOT EXISTS "delivery_included" BOOLEAN NOT NULL DEFAULT false;
