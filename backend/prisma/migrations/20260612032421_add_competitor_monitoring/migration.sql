-- CreateTable
CREATE TABLE "competitor_accounts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL DEFAULT 'VK',
    "handle" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'competitor',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "last_fetched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competitor_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitor_posts" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "external_url" TEXT NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "media_type" TEXT,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "reposts" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "engagement_rate" DOUBLE PRECISION,
    "is_viral" BOOLEAN NOT NULL DEFAULT false,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB,

    CONSTRAINT "competitor_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "competitor_accounts_business_id_idx" ON "competitor_accounts"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "competitor_accounts_business_id_platform_handle_key" ON "competitor_accounts"("business_id", "platform", "handle");

-- CreateIndex
CREATE INDEX "competitor_posts_account_id_published_at_idx" ON "competitor_posts"("account_id", "published_at");

-- CreateIndex
CREATE INDEX "competitor_posts_is_viral_idx" ON "competitor_posts"("is_viral");

-- CreateIndex
CREATE UNIQUE INDEX "competitor_posts_account_id_external_id_key" ON "competitor_posts"("account_id", "external_id");

-- AddForeignKey
ALTER TABLE "competitor_accounts" ADD CONSTRAINT "competitor_accounts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_posts" ADD CONSTRAINT "competitor_posts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "competitor_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

