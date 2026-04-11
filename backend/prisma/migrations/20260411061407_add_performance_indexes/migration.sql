-- DropIndex
DROP INDEX "platform_accounts_business_id_platform_key";

-- CreateIndex
CREATE INDEX "ai_usage_logs_business_id_idx" ON "ai_usage_logs"("business_id");

-- CreateIndex
CREATE INDEX "ai_usage_logs_created_at_idx" ON "ai_usage_logs"("created_at");

-- CreateIndex
CREATE INDEX "content_plans_business_id_idx" ON "content_plans"("business_id");

-- CreateIndex
CREATE INDEX "media_files_business_id_idx" ON "media_files"("business_id");

-- CreateIndex
CREATE INDEX "media_files_post_id_idx" ON "media_files"("post_id");

-- CreateIndex
CREATE INDEX "post_versions_status_idx" ON "post_versions"("status");

-- CreateIndex
CREATE INDEX "post_versions_status_scheduled_at_idx" ON "post_versions"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "posts_business_id_idx" ON "posts"("business_id");

-- CreateIndex
CREATE INDEX "posts_status_idx" ON "posts"("status");
