-- CreateTable
CREATE TABLE "generation_sessions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "prompt" TEXT NOT NULL DEFAULT '',
    "duration" INTEGER NOT NULL DEFAULT 4,
    "aspect_ratio" TEXT NOT NULL DEFAULT '9:16',
    "resolution" TEXT NOT NULL DEFAULT '480p',
    "generate_audio" BOOLEAN NOT NULL DEFAULT false,
    "input_mode" TEXT NOT NULL DEFAULT 'references',
    "reference_images" JSONB,
    "first_frame_url" TEXT,
    "last_frame_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "media_file_id" TEXT,
    "result_url" TEXT,
    "error_message" TEXT,
    "model" TEXT NOT NULL DEFAULT 'bytedance/seedance-2',
    "cost_usd" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "generation_sessions_business_id_idx" ON "generation_sessions"("business_id");
CREATE INDEX "generation_sessions_user_id_idx" ON "generation_sessions"("user_id");
CREATE INDEX "generation_sessions_status_idx" ON "generation_sessions"("status");

-- AddForeignKey
ALTER TABLE "generation_sessions" ADD CONSTRAINT "generation_sessions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "generation_sessions" ADD CONSTRAINT "generation_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "generation_sessions" ADD CONSTRAINT "generation_sessions_media_file_id_fkey" FOREIGN KEY ("media_file_id") REFERENCES "media_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
