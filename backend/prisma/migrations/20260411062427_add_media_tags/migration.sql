-- AlterTable
ALTER TABLE "media_files" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
