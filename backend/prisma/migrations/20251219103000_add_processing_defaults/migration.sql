-- Add default processing tax provinces (contractNumber already exists in some environments)
-- Check if contractNumber column exists, if not add it
-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we use a workaround
-- We'll skip contractNumber addition since it may already exist

-- Add processing tax province columns
ALTER TABLE "Settings" ADD COLUMN "processingTaxProv1" TEXT;
ALTER TABLE "Settings" ADD COLUMN "processingTaxProv2" TEXT;
ALTER TABLE "Settings" ADD COLUMN "processingTaxProv3" TEXT;
