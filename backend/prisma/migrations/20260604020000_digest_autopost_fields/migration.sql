-- Morning digest agent: data-driven AutoPostTasks (no source photo required)
ALTER TABLE "auto_post_tasks" ALTER COLUMN "catalog_id" DROP NOT NULL;
ALTER TABLE "auto_post_tasks" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'photo';
ALTER TABLE "auto_post_tasks" ADD COLUMN "post_type" TEXT;
ALTER TABLE "auto_post_tasks" ADD COLUMN "title" TEXT;
ALTER TABLE "auto_post_tasks" ADD COLUMN "visual_idea" TEXT;
ALTER TABLE "auto_post_tasks" ADD COLUMN "suggested_for" TIMESTAMP(3);

-- index for filtering by source
CREATE INDEX "auto_post_tasks_source_idx" ON "auto_post_tasks"("source");
