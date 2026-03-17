-- AlterTable
ALTER TABLE "template" ADD COLUMN "cached_sources" JSONB;
ALTER TABLE "template" ADD COLUMN "sources_cached_at" TIMESTAMPTZ;
