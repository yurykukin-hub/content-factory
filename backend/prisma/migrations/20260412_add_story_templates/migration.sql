-- CreateTable
CREATE TABLE "story_templates" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '',
    "overlay_text" TEXT NOT NULL DEFAULT '',
    "text_position" TEXT NOT NULL DEFAULT 'bottom',
    "text_color" TEXT NOT NULL DEFAULT '#ffffff',
    "font_size" TEXT NOT NULL DEFAULT 'M',
    "bg_style" TEXT NOT NULL DEFAULT 'dark',
    "link_type" TEXT NOT NULL DEFAULT '',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "story_templates_business_id_idx" ON "story_templates"("business_id");

-- AddForeignKey
ALTER TABLE "story_templates" ADD CONSTRAINT "story_templates_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
