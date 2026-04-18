-- AlterTable
ALTER TABLE "ai_usage_logs" ADD COLUMN     "charged_rub" DOUBLE PRECISION,
ADD COLUMN     "duration_ms" INTEGER,
ADD COLUMN     "error_message" TEXT,
ADD COLUMN     "markup_percent" DOUBLE PRECISION,
ADD COLUMN     "prompt" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'success',
ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "generation_sessions" ADD COLUMN     "audio_url" TEXT,
ADD COLUMN     "audio_weight" DOUBLE PRECISION,
ADD COLUMN     "batch_size" INTEGER,
ADD COLUMN     "batch_task_ids" JSONB,
ADD COLUMN     "chat_history" JSONB,
ADD COLUMN     "completed_task_id" TEXT,
ADD COLUMN     "cover_image_url" TEXT,
ADD COLUMN     "custom_mode" BOOLEAN,
ADD COLUMN     "instrumental" BOOLEAN,
ADD COLUMN     "kie_audio_id" TEXT,
ADD COLUMN     "lyrics" TEXT,
ADD COLUMN     "music_style" TEXT,
ADD COLUMN     "music_title" TEXT,
ADD COLUMN     "negative_tags" TEXT,
ADD COLUMN     "persona_id" TEXT,
ADD COLUMN     "photo_aspect_ratio" TEXT,
ADD COLUMN     "photo_model" TEXT,
ADD COLUMN     "photo_resolution" TEXT,
ADD COLUMN     "stream_audio_url" TEXT,
ADD COLUMN     "style_weight" DOUBLE PRECISION,
ADD COLUMN     "suno_model" TEXT,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'video',
ADD COLUMN     "vocal_gender" TEXT,
ADD COLUMN     "weirdness_constraint" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "balance_kopecks" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "prompt_entries" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'video',
    "prompt" TEXT NOT NULL,
    "result_url" TEXT,
    "rating" INTEGER,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_templates" (
    "id" TEXT NOT NULL,
    "business_id" TEXT,
    "type" TEXT NOT NULL DEFAULT 'video',
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '',
    "prompt" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "music_personas" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "gender" TEXT,
    "sample_media_id" TEXT,
    "suno_persona_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "music_personas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount_kopecks" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "ai_usage_log_id" TEXT,
    "admin_id" TEXT,
    "balance_after" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prompt_entries_business_id_idx" ON "prompt_entries"("business_id");

-- CreateIndex
CREATE INDEX "prompt_entries_type_idx" ON "prompt_entries"("type");

-- CreateIndex
CREATE INDEX "prompt_templates_type_idx" ON "prompt_templates"("type");

-- CreateIndex
CREATE INDEX "balance_transactions_user_id_idx" ON "balance_transactions"("user_id");

-- CreateIndex
CREATE INDEX "balance_transactions_created_at_idx" ON "balance_transactions"("created_at");

-- CreateIndex
CREATE INDEX "ai_usage_logs_user_id_idx" ON "ai_usage_logs"("user_id");

-- CreateIndex
CREATE INDEX "generation_sessions_type_idx" ON "generation_sessions"("type");

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_entries" ADD CONSTRAINT "prompt_entries_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_sessions" ADD CONSTRAINT "generation_sessions_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "music_personas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "music_personas" ADD CONSTRAINT "music_personas_sample_media_id_fkey" FOREIGN KEY ("sample_media_id") REFERENCES "media_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_transactions" ADD CONSTRAINT "balance_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
