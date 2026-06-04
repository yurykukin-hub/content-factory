-- AlterTable: store per-version story publish options (VK button, music) so they survive scheduling
ALTER TABLE "post_versions" ADD COLUMN "publish_options" JSONB;
