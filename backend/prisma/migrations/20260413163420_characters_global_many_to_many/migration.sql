/*
  Warnings:

  - You are about to drop the column `business_id` on the `characters` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "characters" DROP CONSTRAINT "characters_business_id_fkey";

-- DropIndex
DROP INDEX "characters_business_id_idx";

-- AlterTable
ALTER TABLE "characters" DROP COLUMN "business_id";

-- CreateTable
CREATE TABLE "character_businesses" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_businesses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "character_businesses_business_id_idx" ON "character_businesses"("business_id");

-- CreateIndex
CREATE INDEX "character_businesses_character_id_idx" ON "character_businesses"("character_id");

-- CreateIndex
CREATE UNIQUE INDEX "character_businesses_character_id_business_id_key" ON "character_businesses"("character_id", "business_id");

-- AddForeignKey
ALTER TABLE "character_businesses" ADD CONSTRAINT "character_businesses_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_businesses" ADD CONSTRAINT "character_businesses_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
