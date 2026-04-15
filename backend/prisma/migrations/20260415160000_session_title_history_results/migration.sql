-- AlterTable
ALTER TABLE "generation_sessions" ADD COLUMN "title" TEXT NOT NULL DEFAULT '';
ALTER TABLE "generation_sessions" ADD COLUMN "prompt_history" JSONB;
ALTER TABLE "generation_sessions" ADD COLUMN "results" JSONB;
