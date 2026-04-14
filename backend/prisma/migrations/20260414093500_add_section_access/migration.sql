-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "section_access" JSONB;
