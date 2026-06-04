-- AlterTable
ALTER TABLE "brand_profiles" ADD COLUMN     "content_strategy" TEXT,
ADD COLUMN     "season_hints" JSONB;

-- CreateTable
CREATE TABLE "rubrics" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rubrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "occasions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "month_day" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "rubric" TEXT NOT NULL,
    "post_type" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "occasions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rubrics_business_id_idx" ON "rubrics"("business_id");

-- CreateIndex
CREATE INDEX "occasions_business_id_idx" ON "occasions"("business_id");

-- AddForeignKey
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occasions" ADD CONSTRAINT "occasions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
