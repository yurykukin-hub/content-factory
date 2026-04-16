-- Add KIE task tracking fields to generation_sessions
ALTER TABLE "generation_sessions" ADD COLUMN "kie_task_id" TEXT;
ALTER TABLE "generation_sessions" ADD COLUMN "kie_task_created_at" TIMESTAMP(3);
