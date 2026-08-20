BEGIN;
ALTER TABLE commerce.listing_drafts ADD COLUMN IF NOT EXISTS image_ids text[] NOT NULL DEFAULT '{}';
COMMIT;
