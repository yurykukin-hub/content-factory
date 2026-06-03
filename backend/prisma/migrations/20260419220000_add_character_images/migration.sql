-- CreateTable
CREATE TABLE "character_images" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "media_file_id" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "is_main" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'upload',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "character_images_character_id_idx" ON "character_images"("character_id");

-- CreateIndex
CREATE UNIQUE INDEX "character_images_character_id_media_file_id_key" ON "character_images"("character_id", "media_file_id");

-- AddForeignKey
ALTER TABLE "character_images" ADD CONSTRAINT "character_images_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_images" ADD CONSTRAINT "character_images_media_file_id_fkey" FOREIGN KEY ("media_file_id") REFERENCES "media_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
