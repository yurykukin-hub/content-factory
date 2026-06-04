-- Overlay design presets: global (businessId null) + system flag + extra style fields
ALTER TABLE "story_templates" ALTER COLUMN "business_id" DROP NOT NULL;
ALTER TABLE "story_templates" ADD COLUMN "is_system" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "story_templates" ADD COLUMN "text_align" TEXT NOT NULL DEFAULT 'center';
ALTER TABLE "story_templates" ADD COLUMN "bg_radius" TEXT NOT NULL DEFAULT 'round';
