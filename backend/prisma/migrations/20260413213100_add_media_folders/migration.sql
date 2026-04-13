-- CreateTable
CREATE TABLE IF NOT EXISTS "media_folders" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_folders_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "media_files" ADD COLUMN IF NOT EXISTS "folder_id" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "media_folders_business_id_idx" ON "media_folders"("business_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "media_folders_parent_id_idx" ON "media_folders"("parent_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "media_files_folder_id_idx" ON "media_files"("folder_id");

-- AddForeignKey (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_folders_business_id_fkey') THEN
    ALTER TABLE "media_folders" ADD CONSTRAINT "media_folders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_folders_parent_id_fkey') THEN
    ALTER TABLE "media_folders" ADD CONSTRAINT "media_folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "media_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_files_folder_id_fkey') THEN
    ALTER TABLE "media_files" ADD CONSTRAINT "media_files_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "media_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
