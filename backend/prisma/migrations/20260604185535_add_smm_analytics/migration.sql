-- CreateTable
CREATE TABLE "social_post_metric_snapshots" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "post_id" TEXT,
    "post_version_id" TEXT,
    "platform" "Platform" NOT NULL,
    "source" TEXT NOT NULL,
    "publication_type" TEXT NOT NULL DEFAULT 'POST',
    "external_id" TEXT NOT NULL,
    "external_url" TEXT,
    "impressions" INTEGER,
    "reach" INTEGER,
    "views" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "saves" INTEGER,
    "story_exits" INTEGER,
    "story_replies" INTEGER,
    "engagement_rate" DOUBLE PRECISION,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB,

    CONSTRAINT "social_post_metric_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_account_metric_snapshots" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "source" TEXT NOT NULL,
    "account_external_id" TEXT NOT NULL,
    "metric_code" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "metric_date" DATE NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB,

    CONSTRAINT "social_account_metric_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_traffic_snapshots" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "counter_id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'METRIKA',
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_content" TEXT,
    "post_id" TEXT,
    "metric_date" DATE NOT NULL,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "users" INTEGER,
    "bounce_rate" DOUBLE PRECISION,
    "goal_reaches" JSONB,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB,

    CONSTRAINT "site_traffic_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_reports" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "summary" TEXT NOT NULL,
    "findings" JSONB,
    "recommendations" JSONB,
    "metrics_json" JSONB,
    "model" TEXT NOT NULL DEFAULT 'anthropic/claude-sonnet-4',
    "generated_by" TEXT NOT NULL DEFAULT 'agent',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "analytics_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_post_metric_snapshots_business_id_platform_idx" ON "social_post_metric_snapshots"("business_id", "platform");

-- CreateIndex
CREATE INDEX "social_post_metric_snapshots_post_id_idx" ON "social_post_metric_snapshots"("post_id");

-- CreateIndex
CREATE INDEX "social_post_metric_snapshots_external_id_idx" ON "social_post_metric_snapshots"("external_id");

-- CreateIndex
CREATE INDEX "social_post_metric_snapshots_captured_at_idx" ON "social_post_metric_snapshots"("captured_at");

-- CreateIndex
CREATE INDEX "social_account_metric_snapshots_business_id_platform_idx" ON "social_account_metric_snapshots"("business_id", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "social_account_metric_snapshots_business_id_account_externa_key" ON "social_account_metric_snapshots"("business_id", "account_external_id", "metric_code", "metric_date");

-- CreateIndex
CREATE INDEX "site_traffic_snapshots_business_id_idx" ON "site_traffic_snapshots"("business_id");

-- CreateIndex
CREATE INDEX "site_traffic_snapshots_post_id_idx" ON "site_traffic_snapshots"("post_id");

-- CreateIndex
CREATE INDEX "site_traffic_snapshots_metric_date_idx" ON "site_traffic_snapshots"("metric_date");

-- CreateIndex
CREATE UNIQUE INDEX "site_traffic_snapshots_business_id_counter_id_utm_content_u_key" ON "site_traffic_snapshots"("business_id", "counter_id", "utm_content", "utm_source", "metric_date");

-- CreateIndex
CREATE INDEX "analytics_reports_business_id_idx" ON "analytics_reports"("business_id");

-- CreateIndex
CREATE INDEX "analytics_reports_status_idx" ON "analytics_reports"("status");

-- AddForeignKey
ALTER TABLE "social_post_metric_snapshots" ADD CONSTRAINT "social_post_metric_snapshots_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post_metric_snapshots" ADD CONSTRAINT "social_post_metric_snapshots_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post_metric_snapshots" ADD CONSTRAINT "social_post_metric_snapshots_post_version_id_fkey" FOREIGN KEY ("post_version_id") REFERENCES "post_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_account_metric_snapshots" ADD CONSTRAINT "social_account_metric_snapshots_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_traffic_snapshots" ADD CONSTRAINT "site_traffic_snapshots_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_traffic_snapshots" ADD CONSTRAINT "site_traffic_snapshots_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_reports" ADD CONSTRAINT "analytics_reports_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
