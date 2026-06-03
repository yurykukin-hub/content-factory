-- CreateTable
CREATE TABLE "photo_catalog" (
    "id" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_hash" TEXT,
    "file_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_date" TIMESTAMP(3),
    "album_name" TEXT,
    "thumb_path" TEXT,
    "ai_description" TEXT,
    "ai_business" TEXT,
    "ai_confidence" DOUBLE PRECISION,
    "ai_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ai_analyzed_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'indexed',
    "media_file_id" TEXT,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photo_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_post_tasks" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "catalog_id" TEXT NOT NULL,
    "post_id" TEXT,
    "media_file_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "proposed_text" TEXT NOT NULL,
    "proposed_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ai_reasoning" TEXT,
    "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tg_message_id" TEXT,
    "proposed_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_post_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "photo_catalog_file_path_key" ON "photo_catalog"("file_path");

-- CreateIndex
CREATE INDEX "photo_catalog_status_idx" ON "photo_catalog"("status");

-- CreateIndex
CREATE INDEX "photo_catalog_ai_business_idx" ON "photo_catalog"("ai_business");

-- CreateIndex
CREATE INDEX "photo_catalog_file_date_idx" ON "photo_catalog"("file_date");

-- CreateIndex
CREATE INDEX "auto_post_tasks_status_idx" ON "auto_post_tasks"("status");

-- CreateIndex
CREATE INDEX "auto_post_tasks_business_id_idx" ON "auto_post_tasks"("business_id");
